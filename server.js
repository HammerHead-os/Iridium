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

const PORT = 3001;
app.listen(PORT, () => console.log(`Pathfinder 2.1 Backend running on port ${PORT}`));
