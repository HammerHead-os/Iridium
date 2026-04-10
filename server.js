import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Pizzip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


// Initialize Document AI client
const documentClient = new DocumentProcessorServiceClient();

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

// Extract form field positions from PDF using Gemini Vision
async function extractFormFieldPositions(pdfPath, formType) {
  try {
    const pdfDoc = await PDFDocument.load(await fs.readFile(pdfPath), { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();
    
    // Convert first page to image for vision analysis
    const pdfBuffer = await fs.readFile(pdfPath);
    
    // Use Gemini to analyze PDF structure and return field positions
    const visionModel = vertexAI.preview.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    
    const prompt = `Analyze this ${formType === 'cssa' ? 'CSSA Registration' : 'Marriage Search'} PDF form and identify all fillable fields.
    
Return a JSON array of field objects with:
- "label": The field label/name shown on the form
- "x": X position (0-${Math.round(width)})
- "y": Y position (0-${Math.round(height)})  
- "width": Field width
- "height": Field height
- "type": "text" or "checkbox"

Only include fields that need to be filled. Use coordinates in points (1/72 inch).

Example format:
[
  {"label": "Full Name", "x": 100, "y": 650, "width": 200, "height": 20, "type": "text"},
  {"label": "HKID Number", "x": 100, "y": 620, "width": 150, "height": 20, "type": "text"}
]`;
    
    // Since we can't easily convert PDF to image, use text-based approach
    const formFields = await extractFieldsUsingTextAnalysis(formType);
    return formFields;
  } catch (error) {
    console.error('Error extracting form positions:', error);
    return getDefaultFields(formType);
  }
}

// Fallback: Use known field positions for common forms
function getDefaultFields(formType) {
  if (formType === 'cssa') {
    return [
      { label: "name", "x": 120, "y": 680, "width": 180, "height": 15, "type": "text" },
      { label: "hkid", "x": 120, "y": 660, "width": 150, "height": 15, "type": "text" },
      { label: "address", "x": 120, "y": 640, "width": 300, "height": 15, "type": "text" },
      { label: "phone", "x": 120, "y": 620, "width": 150, "height": 15, "type": "text" },
      { label: "income", "x": 120, "y": 600, "width": 150, "height": 15, "type": "text" },
      { label: "employment", "x": 120, "y": 580, "width": 180, "height": 15, "type": "text" },
      { label: "family_size", "x": 120, "y": 560, "width": 80, "height": 15, "type": "text" },
      { label: "date", "x": 120, "y": 540, "width": 120, "height": 15, "type": "text" }
    ];
  } else if (formType === 'marriage_search') {
    return [
      { label: "name", "x": 120, "y": 680, "width": 180, "height": 15, "type": "text" },
      { label: "hkid", "x": 120, "y": 660, "width": 150, "height": 15, "type": "text" },
      { label: "spouse_name", "x": 120, "y": 640, "width": 180, "height": 15, "type": "text" },
      { label: "spouse_hkid", "x": 120, "y": 620, "width": 150, "height": 15, "type": "text" },
      { label: "marriage_date", "x": 120, "y": 600, "width": 120, "height": 15, "type": "text" },
      { label: "marriage_place", "x": 120, "y": 580, "width": 180, "height": 15, "type": "text" }
    ];
  }
  return [];
}

async function extractFieldsUsingTextAnalysis(formType) {
  // For now, return default positions - can be enhanced with actual PDF text extraction
  return getDefaultFields(formType);
}

// Use Document AI to extract form fields and their positions
async function extractFormFieldsWithDocumentAI(pdfPath, formType) {
  try {
    const pdfBuffer = await fs.readFile(pdfPath);
    
    // You need to create a Document AI processor in Google Cloud Console first
    // Go to: https://console.cloud.google.com/documentai
    // Create a "Form Parser" processor and get the processor ID
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    
    if (!processorId) {
      console.log('Document AI Processor ID not set, using fallback fields');
      return getDefaultFields(formType);
    }
    
    const name = `projects/${project}/locations/${location}/processors/${processorId}`;
    
    const request = {
      name,
      rawDocument: {
        content: pdfBuffer,
        mimeType: 'application/pdf',
      },
    };
    
    const [result] = await documentClient.processDocument(request);
    const { document } = result;
    
    // Extract form fields
    const formFields = [];
    const page = document.pages[0];
    
    if (page && page.formFields) {
      for (const field of page.formFields) {
        const fieldName = field.fieldName?.textAnchor?.content || '';
        const fieldValue = field.fieldValue?.textAnchor?.content || '';
        
        // Get bounding polygon coordinates
        const boundingPoly = field.fieldName?.boundingPoly?.normalizedVertices;
        if (boundingPoly && boundingPoly.length >= 4) {
          formFields.push({
            label: fieldName.toLowerCase().replace(/\s+/g, '_'),
            x: boundingPoly[0].xX * 612, // Convert normalized to points (assuming letter size)
            y: (1 - boundingPoly[0].yY) * 792, // Flip Y coordinate
            width: (boundingPoly[2].xX - boundingPoly[0].xX) * 612,
            height: (boundingPoly[0].yY - boundingPoly[2].yY) * 792,
            type: 'text',
            currentValue: fieldValue
          });
        }
      }
    }
    
    console.log(`Extracted ${formFields.length} fields from ${formType} form`);
    return formFields.length > 0 ? formFields : getDefaultFields(formType);
  } catch (error) {
    console.error('Document AI extraction error:', error.message);
    return getDefaultFields(formType);
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    const { history } = req.body;
    
    const systemPrompt = `You are Zoya, a high-agency, specialized AI Advocate for domestic violence survivors in Hong Kong. 
The name Zoya means "Life" (Affirming Survival). Your mission is to help survivors safely exit abusive environments through legal protection.

### HK KNOWLEDGE BASE:
1. **Marriage Certificate**: Replacement costs HK$280 + HK$140 search fee. Office: Admiralty. Processing: 7 working days. Application: MR10 form (we have this in Autofill) or GovHK Online.
2. **CSSA (Financial)**: Registration form needed (we have this in Autofill). Alternative income proof: Tax returns from IRD. Link: https://www.swd.gov.hk/storage/asset/section/41/en/CSSA_Registration_Form(e)_202302.pdf
3. **Legal Aid**: Financial limit HK$452,320. Director can waive limits for Bill of Rights cases. Tel: 2537 7677.
4. **Hotlines**: 
   - Women's Centres (Injunction help): 2586 6255
   - Jockey Club Lai Kok Centre: 2386 6256
   - Free Legal Helpline (One-off 45 min): 8200 8002
5. **Non-Molestation Orders**: Solicitor must draft affidavit. ex parte procedures are complex. 
6. **Matrimonial Law enquiries**: Client must provide Full Name, Spouse Name, HKID alphabet + first 4 digits.

### CSSA FORM FIELDS (Ask for these specifically):
- Full Name
- HKID Number (format: A123456(7))
- Residential Address
- Phone Number
- Monthly Income
- Employment Status
- Number of Family Members
- Date

### MARRIAGE SEARCH FORM FIELDS:
- Full Name
- HKID Number
- Spouse's Full Name  
- Spouse's HKID Number
- Marriage Date
- Marriage Place

### MISSION:
- Help them exit.
- Prioritize DCRVO (Injunctions) and safe housing.
- Ask for ONE piece of information at a time.
- ONLY ask for information that matches the form fields listed above.
- If they mention "CSSA Registration" or "Marriage Search", specifically tell them "I can autofill this official form for you now."
- Extract facts and map them to the exact field names shown above.

### OUTPUT:
You MUST ALWAYS end your response with exactly one JSON block using these delimiters:
   ###JSON_DATA###
   {
     "reply": "Your message with HK specifics",
     "inputType": "text | choice | file",
     "inputLabel": "Short label",
     "options": [...],
     "newDocRequirement": "Doc Name or null",
     "formType": "cssa | marriage_search | null" (Identified autofillable form),
     "extractedFacts": { 
       // Map to EXACT field names: "name", "hkid", "address", "phone", "income", "employment", "family_size", "date"
       // OR for marriage: "name", "hkid", "spouse_name", "spouse_hkid", "marriage_date", "marriage_place"
     }
   }
   ###JSON_END###`;

    const result = await generateAIResponse(history, systemPrompt, true);
    
    const jsonMatch = result.match(/###JSON_DATA###\s*([\s\S]*)\s*###JSON_END###/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        res.json(parsed);
      } catch (e) {
        res.json({ reply: result.split('###JSON_DATA###')[0].trim(), inputType: 'text', inputLabel: 'Next Step', options: [], extractedFacts: {} });
      }
    } else {
      res.json({ reply: result, inputType: 'text', inputLabel: 'Next Steps', options: [], extractedFacts: {} });
    }
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// New Endpoint for Local Autofilling
app.post('/api/fill-known-form', async (req, res) => {
  try {
    const { formType, caseFile } = req.body;
    let fileName = "";
    if (formType === 'cssa') fileName = 'CSSA_Registration_Form(e)_202302.pdf';
    else if (formType === 'marriage_search') fileName = 'request for search or marriage records.pdf';
    else return res.status(400).json({ error: "Unknown form type" });

    const filePath = path.join(process.cwd(), 'legal_docs', fileName);
    const pdfBuffer = await fs.readFile(filePath);
    
    // Get field positions for this form type
    const fieldPositions = getDefaultFields(formType);
    
    // Use AI to map caseFile to form fields
    const mappingPrompt = `You are a legal document assistant. 
Case File: ${JSON.stringify(caseFile)}
Form Type: ${formType}

Map the case file data to these form fields: ${JSON.stringify(fieldPositions.map(f => f.label))}

Return a JSON object mapping field labels to values from the case file.
Only include fields where you have data.

Example: {"name": "John Doe", "hkid": "A123456(7)"}`;
    
    const generativeModel = vertexAI.preview.getGenerativeModel({ 
      model: textModel, 
      generationConfig: { responseMimeType: "application/json" } 
    });
    const aiMap = await generativeModel.generateContent({ 
      contents: [{role: 'user', parts:[{text: mappingPrompt}]}]
    });
    const mappedData = JSON.parse(aiMap.response.candidates[0].content.parts[0].text);

    // Load PDF and embed text at correct positions
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    
    // Draw text at field positions
    for (const field of fieldPositions) {
      const value = mappedData[field.label];
      if (value) {
        firstPage.drawText(String(value), {
          x: field.x,
          y: field.y,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: field.width
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Filled_${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error filling known form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Real-time Preview Endpoint
app.post('/api/preview-known-form', async (req, res) => {
  try {
    const { formType, caseFile } = req.body;
    let fileName = "";
    if (formType === 'cssa') fileName = 'CSSA_Registration_Form(e)_202302.pdf';
    else if (formType === 'marriage_search') fileName = 'request for search or marriage records.pdf';
    else return res.status(400).json({ error: "Unknown form type" });

    const filePath = path.join(process.cwd(), 'legal_docs', fileName);
    const pdfBuffer = await fs.readFile(filePath);
    
    // Get field positions
    const fieldPositions = getDefaultFields(formType);
    
    // AI mapping
    const mappingPrompt = `Map case file: ${JSON.stringify(caseFile)} to these form fields: ${JSON.stringify(fieldPositions.map(f => f.label))}. Return raw JSON with field-label to value mapping.`;
    const genModel = vertexAI.preview.getGenerativeModel({ 
      model: textModel, 
      generationConfig: { responseMimeType: "application/json" } 
    });
    const aiResp = await genModel.generateContent({ 
      contents: [{role: 'user', parts:[{text: mappingPrompt}]}]
    });
    const mappedData = JSON.parse(aiResp.response.candidates[0].content.parts[0].text);

    // Load PDF and embed text
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    
    // Draw text at field positions
    for (const field of fieldPositions) {
      const value = mappedData[field.label];
      if (value) {
        firstPage.drawText(String(value), {
          x: field.x,
          y: field.y,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: field.width
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// General upload-based filling
app.post('/api/fill-document', upload.single('template'), async (req, res) => {
  try {
    const { caseFile } = req.body;
    const template = req.file;
    if (!template) return res.status(400).json({ error: "No template uploaded" });
    
    const mappingPrompt = `Map case file: ${JSON.stringify(caseFile)} to form tags. Response raw JSON.`;
    const genModel = vertexAI.preview.getGenerativeModel({ model: textModel, generationConfig: { responseMimeType: "application/json" } });
    const aiResp = await genModel.generateContent({ contents: [{role: 'user', parts:[{text: mappingPrompt}]}]});
    const mappedData = JSON.parse(aiResp.response.candidates[0].content.parts[0].text);

    if (template.originalname.endsWith('.docx')) {
       const zip = new Pizzip(template.buffer);
       const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
       doc.render(mappedData);
       const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
       res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
       return res.send(buf);
    } else {
       const pdfDoc = await PDFDocument.load(template.buffer, { ignoreEncryption: true });
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

// Diagnostic Endpoint to discover PDF Field IDs
app.get('/api/debug-fields', async (req, res) => {
  try {
    const docs = [
      'CSSA_Registration_Form(e)_202302.pdf', 
      'request for search or marriage records.pdf'
    ];
    let results = {};
    for (const fileName of docs) {
      const filePath = path.join(process.cwd(), 'legal_docs', fileName);
      const pdfBuffer = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      results[fileName] = form.getFields().map(f => ({ name: f.getName(), type: f.constructor.name }));
    }
    res.json(results);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Extract form fields using Document AI
app.get('/api/extract-form-fields', async (req, res) => {
  try {
    const { formType } = req.query;
    if (!formType || !['cssa', 'marriage_search'].includes(formType)) {
      return res.status(400).json({ error: 'Invalid formType. Use cssa or marriage_search' });
    }
    
    const fileName = formType === 'cssa' 
      ? 'CSSA_Registration_Form(e)_202302.pdf' 
      : 'request for search or marriage records.pdf';
    
    const filePath = path.join(process.cwd(), 'legal_docs', fileName);
    const fields = await extractFormFieldsWithDocumentAI(filePath, formType);
    
    res.json({ formType, fileName, fields });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Zoya HK Backend running on port ${PORT}`));
