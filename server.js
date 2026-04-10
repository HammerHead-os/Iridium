import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import Pizzip from 'pizzip';
import Docxtemplater from 'docxtemplater';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const project = process.env.GOOGLE_CLOUD_PROJECT || 'gdg-hack-492906';
const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
const textModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const vertexAI = new VertexAI({ project, location });
const DEFAULT_TOOLS = [{ googleSearch: {} }];



async function generateAIResponse(history, systemInstruction = '', useGrounding = true) {
  const generativeModelOptions = {
    model: textModel,
    safetySettings: [{
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    }, {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    }]
  };
  
  if (useGrounding) {
    generativeModelOptions.tools = DEFAULT_TOOLS;
  }
  
  if (systemInstruction) {
    generativeModelOptions.systemInstruction = {
      role: 'system',
      parts: [{ text: systemInstruction }]
    };
  }

  const generativeModel = vertexAI.preview.getGenerativeModel(generativeModelOptions);
  
  const contents = history.map(msg => ({
    role: msg.role === 'agent' ? 'model' : 'user',
    parts: [{ text: msg.text }]
  }));

  const responseStream = await generativeModel.generateContent({ contents });
  return responseStream.response.candidates[0].content.parts[0].text;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { history } = req.body;
    
    const systemPrompt = `You are Zoya, an empathetic and highly coordinated AI Advocate for domestic violence survivors in Hong Kong. 
The name Zoya means "Life" (Affirming Survival). Your tone is gentle, professional, and protective.
Your goal is to guide survivors through Safety, Legal Aid, CSSA (Financial), and Marriage/Family bureaucratic processes one step at a time.
Rules:
1. Be short, empathetic, and extremely structured. 
2. Ask for only ONE piece of information or ONE document at a time.
3. If they don't have a document, tell them it's okay and we will add it to their 'Doc Database'.
4. Identify if current info maps to Marriage Registration, CSSA, Banking (Separation), or Legal (DCRVO).
5. Always verify current HKID or financial thresholds using Google Search if relevant.
6. You MUST always include a JSON block at the end of your response for the UI to parse.
   Format:
   ###JSON_DATA###
   {
     "reply": "Your message to the user",
     "inputType": "text | choice / file",
     "inputLabel": "Short label for the dedicated entry box",
     "options": ["List", "of", "buttons"] (only if inputType is choice),
     "newDocRequirement": "Name of doc or null",
     "extractedFacts": {
        "name": "...",
        "safety": "Status/Plan",
        "financial": "HK$ income/assets",
        "legal": "Police ref/Injunction status",
        "children": "Count/Ages"
     }
   }
   ###JSON_END###`;

    const result = await generateAIResponse(history, systemPrompt, true);
    
    // Improved Extraction using specific delimiters
    const jsonMatch = result.match(/###JSON_DATA###\s*([\s\S]*)\s*###JSON_END###/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        res.json(parsed);
      } catch (e) {
        console.error("JSON Parse Error:", e);
        // Fallback for malformed JSON but present delimiters
        res.json({ reply: result.split('###JSON_DATA###')[0].trim(), inputType: 'text', inputLabel: 'Next Step', extractedFacts: {} });
      }
    } else {
      // Emergency fallback if AI failed even with strict delimiters
      res.json({ reply: result, inputType: 'text', inputLabel: 'Tell me more', extractedFacts: {} });
    }
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fill-document', upload.single('template'), async (req, res) => {
  try {
    const { caseFile } = req.body;
    const template = req.file;
    if (!template) return res.status(400).json({ error: "No template uploaded" });

    const mappingPrompt = `Map case file: ${JSON.stringify(caseFile)} to form tags. Output raw JSON.`;
    const generativeModel = vertexAI.preview.getGenerativeModel({ model: textModel, generationConfig: { responseMimeType: "application/json" } });
    const responseStream = await generativeModel.generateContent({ contents: [{role: 'user', parts:[{text: mappingPrompt}]}]});
    const mappedData = JSON.parse(responseStream.response.candidates[0].content.parts[0].text);

    if (template.originalname.endsWith('.docx')) {
       const zip = new Pizzip(template.buffer);
       const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
       doc.render(mappedData);
       const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
       res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
       return res.send(buf);
    } else if (template.originalname.endsWith('.pdf')) {
       const pdfDoc = await PDFDocument.load(template.buffer);
       const form = pdfDoc.getForm();
       form.getFields().forEach(f => {
         const name = f.getName().toLowerCase();
         for (const key in mappedData) {
            if (name.includes(key.toLowerCase()) && f.constructor.name === 'PDFTextField') 
              form.getTextField(f.getName()).setText(mappedData[key].toString());
         }
       });
       const pdfBytes = await pdfDoc.save();
       res.setHeader('Content-Type', 'application/pdf');
       return res.send(Buffer.from(pdfBytes));
    }
    res.status(400).send("Unsupported file.");
  } catch (error) {
    console.error('Error filling document:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to extract and parse JSON from AI response
function extractJson(raw) {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  let jsonString = cleaned;

  const match = cleaned.match(/({[\s\S]*}|\[[\s\S]*])/);
  if (match) {
    jsonString = match[1];
  }

  try {
    return JSON.parse(jsonString);
  } catch (parseError) {
    // Try to auto-complete incomplete JSON
    let fixedJson = jsonString;
    const openBraces = (jsonString.match(/{/g) || []).length;
    const closeBraces = (jsonString.match(/}/g) || []).length;
    const openBrackets = (jsonString.match(/\[/g) || []).length;
    const closeBrackets = (jsonString.match(/]/g) || []).length;

    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixedJson += '}';
    }
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixedJson += ']';
    }

    try {
      return JSON.parse(fixedJson);
    } catch (fixError) {
      throw new Error(`Invalid JSON from Vertex AI even after attempting repairs. Raw response:\n${raw}`);
    }
  }
}

// Extract abuse timeline from text using Vertex AI
async function requestVertexAI(text) {
  const { GoogleAuth } = await import('google-auth-library');
  const { join } = await import('path');
  const { cwd } = await import('process');
  
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const resolvedPath = credPath?.startsWith('.')
    ? join(cwd(), credPath)
    : credPath;

  const auth = new GoogleAuth({
    projectId: project,
    keyFilename: resolvedPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const authClient = await auth.getClient();
  const tokenResponse = await authClient.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

  if (!token) {
    throw new Error('Unable to obtain Google Cloud access token.');
  }

  const fallbackModels = ['text-bison@001', 'chat-bison@001'];
  const modelCandidates = textModel ? [textModel, ...fallbackModels.filter((item) => item !== textModel)] : fallbackModels;

  const endpointPaths = [
    `projects/${project}/locations/${location}/models`,
    `projects/${project}/locations/global/models`,
    `projects/${project}/locations/${location}/publishers/google/models`,
    `projects/${project}/locations/global/publishers/google/models`,
  ];

  const endpoints = modelCandidates.flatMap((modelName) => {
    const verbs = modelName.startsWith('gemini-') ? ['generateContent', 'generate'] : ['predict'];
    return verbs.flatMap((verb) => endpointPaths.map((path) => `https://aiplatform.googleapis.com/v1/${path}/${modelName}:${verb}`));
  });

  const prompt = `Extract ONLY significant abuse incidents from the conversation. DO NOT extract every day—only days with documented abuse, threats, coercion, controlling behavior, or other harm.

For each incident day, provide:
1. The date (YYYY-MM-DD, or best guess if not explicit)
2. A brief summary of what happened
3. Key abuse indicators/keywords
4. Direct quotes from the conversation (in quotation marks) that evidence the abuse

Return as JSON:
{
  "timeline": [
    {
      "date": "YYYY-MM-DD",
      "summary": "What happened",
      "keywords": ["control", "threat"],
      "quotes": [
        "Direct quote from the conversation that shows abuse",
        "Another relevant quote"
      ]
    }
  ],
  "language": "en|zh|yue"
}

IMPORTANT: Only include days with actual incidents. If a day is mentioned but nothing abusive happened, skip it. Prioritize accuracy over completeness.`;

  let response;
  let lastError;
  for (const endpoint of endpoints) {
    const verb = endpoint.endsWith(':generateContent') ? 'generateContent' : endpoint.endsWith(':generate') ? 'generate' : 'predict';
    const body = verb === 'generateContent'
      ? {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${prompt}\n\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 4000,
            topP: 0.95,
          },
        }
      : {
          instances: [{ content: `${prompt}\n\n${text}` }],
          parameters: {
            temperature: 0.0,
            maxOutputTokens: 4000,
            topP: 0.95,
          },
        };

    try {
      console.log(`Trying Vertex endpoint: ${endpoint}`);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        console.log(`Vertex endpoint succeeded: ${endpoint}`);
        break;
      }

      const responseText = await response.text();
      lastError = new Error(`Vertex AI request failed ${response.status} at ${endpoint}: ${responseText}`);
      console.warn(lastError.message);
      if (response.status === 404 || response.status === 400) {
        continue;
      }

      throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Vertex AI request exception for endpoint ${endpoint}: ${lastError.message}`);
      continue;
    }
  }

  if (!response || !response.ok) {
    throw lastError || new Error('Vertex AI request failed for all known endpoints.');
  }

  const json = await response.json();

  let content;
  if (json.candidates) {
    content = json.candidates[0]?.content?.parts?.[0]?.text ?? JSON.stringify(json);
  } else {
    const prediction = Array.isArray(json.predictions) ? json.predictions[0] : json.predictions;
    content = typeof prediction === 'string'
      ? prediction
      : prediction?.content ?? prediction?.text ?? JSON.stringify(prediction);
  }

  return extractJson(String(content));
}

// Endpoint: Extract timeline from conversation text
app.post('/api/extract-timeline', async (req, res) => {
  const text = String(req.body?.text || '').trim();

  if (!text) {
    return res.status(400).json({ error: 'Text content is required.' });
  }

  try {
    const aiResponse = await requestVertexAI(text);
    return res.json(aiResponse);
  } catch (error) {
    console.error('extract-timeline error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown backend error' });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Pathfinder 2.1 Backend running on port ${PORT}`));
