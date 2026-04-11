import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
// Lazy-load Document AI only when needed
let documentClient = null;
async function getDocumentClient() {
  if (!documentClient) {
    try {
      const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');
      documentClient = new DocumentProcessorServiceClient();
    } catch(e) {
      console.warn('Document AI not available:', e.message);
    }
  }
  return documentClient;
}
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
    // A4 page: 595.32 x 841.92 points. y=0 is bottom, y=842 is top.
    // Positions calibrated to the actual CSSA Registration Form layout
    return [
      { label: "name",       x: 255, y: 718, type: "text" },  // "Name of applicant:" row
      { label: "hkid",       x: 255, y: 700, type: "text" },  // "Identity document no.:" row
      { label: "address",    x: 310, y: 670, type: "text" },  // "Residential address:" row
      { label: "employment", x: 230, y: 685, type: "text" },  // "Occupation:" row
      { label: "income",     x: 380, y: 685, type: "text" },  // "Monthly income:" on same row
      { label: "phone",      x: 255, y: 622, type: "text" },  // "Residential phone no.:" row
      { label: "family_size",x: 170, y: 575, type: "text" },  // Significant changes text area
      { label: "date",       x: 350, y: 700, type: "text" },  // "Date of birth:" on ID row
    ];
  } else if (formType === 'marriage_search') {
    return [
      { label: "name",          x: 200, y: 620, type: "text" },
      { label: "hkid",          x: 200, y: 595, type: "text" },
      { label: "spouse_name",   x: 200, y: 565, type: "text" },
      { label: "spouse_hkid",   x: 200, y: 540, type: "text" },
      { label: "marriage_date", x: 200, y: 510, type: "text" },
      { label: "marriage_place",x: 200, y: 485, type: "text" },
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
    
    const client = await getDocumentClient();
    if (!client) return getDefaultFields(formType);
    
    const [result] = await client.processDocument(request);
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
    const { history, lang } = req.body;
    
    const langInstruction = lang === 'zh' 
      ? '\n\nIMPORTANT: Respond in Traditional Chinese (繁體中文). Use Cantonese-friendly phrasing. Keep the same format with bullet points and line breaks.'
      : '';
    
    const systemPrompt = `You are Zoya, a high-agency AI Advocate for domestic violence survivors in Hong Kong.
You are NOT a chatbot. You are an AUTONOMOUS AGENT. The survivor tells her story ONCE. You fight the system for her.

## YOUR OPERATING PROTOCOL — THE TIMELINE:

### HOUR 0: FIRST CONTACT
When someone first messages you:
- Ask ONLY 3 things: Are you safe right now? Do you have children? Do you need to leave tonight?
- From these answers, MAP every service she'll need and the ORDER they must happen in.
- IMMEDIATELY output a phased plan in your response.
- Set casePhase to "hour0_intake"

### HOUR 1: IMMEDIATE SAFETY
If she needs shelter NOW:
- INSTANTLY provide ALL 5 SWD refuge centres + Caritas:
  • Harmony House 24hr: 2522 0434 (Wan Chai, women + children)
  • SWD Emergency Placement: 2343 2255 (24hr, all 5 centres, 268 beds total)
  • Po Leung Kuk: 2381 0010 (temporary refuge)
  • Caritas Family Crisis: 18288 (24hr crisis)
  • Refuge Centre Tuen Mun: 2655 7700
- Match based on: her location, children, language needs
- Set casePhase to "hour1_safety"

### HOURS 2-24: EVIDENCE BUILDING
Once safe, ask: "Do you have WhatsApp chats with him? Can you export them?"
- Tell her to use the Evidence Extractor (button in the app)
- Also accept: screenshots, bank statements, social media — tell her to upload via the doc panel
- The AI will auto-parse everything. She just shares what she has.
- Set casePhase to "evidence_building"

### DAYS 2-7: CASE FILE GROWS
Every new message she sends about what's happening:
- Auto-timestamp and categorize by abuse type
- Connect to previous incidents to show patterns
- Track escalation — if frequency increases, FAST-TRACK safety steps
- Translate her plain language into legal terminology
- Set casePhase to "case_growing"

### DAY 7: LEGAL PATHWAY
When enough evidence exists:
- Calculate Legal Aid eligibility (under HK$452,320)
- Pre-fill Legal Aid application
- Generate injunction application under DCRVO Cap. 189
- If urgent: flag for ex parte order (without abuser present)
- Tell her: "Your case file is ready. One click to export for your solicitor."
- Set casePhase to "legal_activated"
- Set formType to trigger relevant forms

### DAYS 7-14: FINANCIAL INDEPENDENCE
While legal process moves:
- Pre-fill CSSA application
- Identify missing documents and alternative channels to get them
- CRITICAL: Sequence financial separation carefully — closing joint accounts can ALERT the abuser
- Wait for injunction before alerting actions
- Set casePhase to "financial_separation"

### DAYS 14-30: HOUSING PIPELINE
Before refuge stay expires:
- Confirm compassionate rehousing prerequisites (divorce petition, SWD referral, DV evidence)
- Identify transitional housing
- She never has to discover compassionate rehousing exists — YOU trigger it
- Set casePhase to "housing_pipeline"

### DAYS 30-90: RECOVERY
- School transfer paperwork (protective order removes need for abuser's signature)
- Childcare assistance via SWD
- Employment support referrals
- CSSA review preparation
- Monitor injunction violations — if breached, draft breach report with evidence
- Set casePhase to "recovery"

## DANGER ESCALATION SCORING:
Track these signals across messages. If 3+ are present, FAST-TRACK to legal pathway:
- Frequency of incidents increasing
- Physical violence mentioned
- Threats to children
- Stalking or showing up at workplace
- Financial control tightening
- Weapons mentioned
- "He said he'd kill me/himself"
Output dangerLevel: "low" | "medium" | "high" | "critical"

## RESOURCE DATABASE:
### SHELTERS: Harmony House 2522 0434, SWD 2343 2255, Po Leung Kuk 2381 0010, Caritas 18288, Tuen Mun 2655 7700
### LEGAL: Legal Aid 2537 7677 (limit HK$452,320), Free Legal Helpline 8200 8002, Women's Centre 2586 6255
### POLICE: 999 (emergency), nearest station for DV case number
### FINANCIAL: CSSA (we autofill), Marriage cert replacement HK$280+$140 at Admiralty

## FORM FIELDS (collect ONE at a time, extract from conversation first):
CSSA: name, hkid, dob, sex, marital_status, address, phone, income, employment, family_size, accommodation, savings, cssa_reason, maintenance
Marriage Search: name, hkid, spouse_name, spouse_hkid, marriage_date, marriage_place

## PROACTIVE DATA COLLECTION:
After addressing the immediate crisis, proactively ask for missing profile data ONE field at a time.
Prioritize in this order:
1. Name and HKID (needed for everything)
2. Address and phone (needed for shelter + forms)
3. Children details (affects custody + school + housing)
4. Spouse name and HKID (needed for injunction + marriage search)
5. Financial details (needed for CSSA + Legal Aid)
6. Marriage details (needed for divorce + marriage cert)

Frame questions naturally:
- "To prepare your CSSA application, I need your HKID number. What is it?"
- "How many people are in your family including children?"
- "What is your current accommodation situation?"
- "Do you have any savings or assets?"
Don't ask for data the user already provided earlier in the conversation.

## PHOTO EVIDENCE:
When the case involves physical abuse or property damage, proactively ask:
- "Do you have photos of any injuries? You can upload them securely — they'll be stored in a hidden gallery only Zoya can access."
- "Screenshots of threatening messages can be uploaded too — just drag them into the chat."
Frame it as easy: "Just share what you already have. Zoya does the rest."

## RESPONSE RULES:
- MAXIMUM 4 short lines of text per response. No exceptions.
- Use line breaks (\\n) between every point. NEVER write a wall of text.
- Format: one short empathy line → action items as bullet points → one question
- Each bullet point on its own line with "• " prefix
- Phone numbers get their own line
- NEVER write more than 2 sentences in a row without a line break
- Keep each line under 80 characters
- NO paragraphs. Only short punchy lines.

Example good response:
"I hear you, Theia. Here's what we do right now:\\n\\n• Call Harmony House: 2522 0434 (24hr, Wan Chai)\\n• SWD Emergency Placement: 2343 2255\\n• Caritas Crisis Line: 18288\\n\\nI'm mapping your full exit plan. Are you safe where you are right now?"

## INCLUDE LIVE LINKS when relevant. Use full URLs:
- Legal Aid: https://www.lad.gov.hk
- CSSA Info: https://www.swd.gov.hk/en/index/site_pubsvc/page_socsecu/sub_socialsecurity/
- SWD DV Services: https://www.swd.gov.hk/en/index/site_pubsvc/page_family/sub_listofserv/id_violencecase/
- Harmony House: https://www.harmonyhousehk.org
- Legal Aid Application: https://www.lad.gov.hk/eng/documents/pdfform/Form3.pdf
- GovHK Marriage Records: https://www.gov.hk/en/residents/immigration/bdmreg/marriage/marriagerecordsearch.htm
- Housing Authority: https://www.housingauthority.gov.hk
- Police Online Report: https://www.police.gov.hk/ppp_en/contact_us.html
- Duty Lawyer Service: https://www.dutylawyer.org.hk

## OUTPUT FORMAT (MUST end every response with this):
###JSON_DATA###
{
  "reply": "Your actionable message",
  "inputType": "text | choice",
  "inputLabel": "Short label",
  "options": [],
  "newDocRequirement": null,
  "formType": "cssa | marriage_search | null",
  "extractedFacts": {
    "name": null, "safety": "safe|unsafe|at_risk",
    "financial": null, "legal": null, "children": null,
    "spouse_name": null, "hkid": null, "address": null, "phone": null,
    "dob": null, "sex": null, "marital_status": null,
    "employment": null, "income": null, "savings": null,
    "accommodation": null, "cssa_reason": null, "marriage_date": null, "marriage_place": null
  },
  "casePhase": "hour0_intake|hour1_safety|evidence_building|case_growing|legal_activated|financial_separation|housing_pipeline|recovery",
  "dangerLevel": "low|medium|high|critical",
  "autoActions": ["action descriptions the agent is taking autonomously"]
}
###JSON_END###

CRITICAL: Extract ALL facts from the ENTIRE conversation history. If she said her name 5 messages ago, it's still her name. ALWAYS include safety status and dangerLevel. ALWAYS include casePhase.` + langInstruction;

    const result = await generateAIResponse(history, systemPrompt, true);
    
    const jsonMatch = result.match(/###JSON_DATA###\s*([\s\S]*)\s*###JSON_END###/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        // Ensure new fields have defaults
        parsed.casePhase = parsed.casePhase || 'hour0_intake';
        parsed.dangerLevel = parsed.dangerLevel || 'low';
        parsed.autoActions = parsed.autoActions || [];
        res.json(parsed);
      } catch (e) {
        res.json({ reply: result.split('###JSON_DATA###')[0].trim(), inputType: 'text', inputLabel: 'Next Step', options: [], extractedFacts: {}, casePhase: 'hour0_intake', dangerLevel: 'low', autoActions: [] });
      }
    } else {
      res.json({ reply: result, inputType: 'text', inputLabel: 'Next Steps', options: [], extractedFacts: {}, casePhase: 'hour0_intake', dangerLevel: 'low', autoActions: [] });
    }
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== GEMINI VISION SMART FILL =====
// Cache so Gemini is only called once per form file (keyed by filename)
const fieldPositionCache = {};

// Ask Gemini Vision to read the PDF and return field positions as percentages
async function detectFieldsWithGemini(pdfBuffer, pageWidth, pageHeight) {
  const pdfBase64 = pdfBuffer.toString('base64');

  const model = vertexAI.preview.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `You are a form-analysis agent. This is a government PDF form.

Identify every blank fillable field where a person would write their information (name, ID, date, address, phone, income, signature areas, checkboxes, etc.).

For EACH field return:
- "semantic_key": A snake_case key describing what data goes here (e.g. "applicant_name", "hkid_number", "date_of_birth", "monthly_income", "home_address", "phone_number", "spouse_name", "marriage_date", "number_of_children")
- "label_text": The exact printed label text next to this field on the form
- "x_pct": X coordinate of where to START writing, as a decimal 0.0-1.0 (proportion of page width from left)
- "y_pct": Y coordinate from TOP of page, as a decimal 0.0-1.0 (proportion of page height)
- "field_type": "text" | "date" | "checkbox" | "number"

Rules:
- Page dimensions are ${Math.round(pageWidth)}x${Math.round(pageHeight)} points
- Return ONLY fields that need user input — skip printed text, headings, instructions
- x_pct and y_pct should point to where the ANSWER should be written (just after or below the label)
- Be precise. Small errors cause text to land outside the field.

Return a JSON array: [{"semantic_key":"...","label_text":"...","x_pct":0.0,"y_pct":0.0,"field_type":"text"}, ...]`;

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
        { text: prompt }
      ]
    }]
  });

  const raw = result.response.candidates[0].content.parts[0].text;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.fields || []);
  } catch(e) {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini Vision returned unparseable field data: ' + raw.slice(0, 300));
  }
}

// Semantically match detected Gemini fields to the caseFile
function matchFieldToCaseFile(semanticKey, labelText, caseFile) {
  const key = (semanticKey + ' ' + labelText).toLowerCase();

  // Direct semantic matching — no hard-coded form knowledge
  const matchers = [
    { patterns: ['name', 'applicant name', 'full name', 'your name'], value: caseFile.name },
    { patterns: ['hkid', 'identity doc', 'id number', 'id no', 'id card'], value: caseFile.hkid },
    { patterns: ['date of birth', 'dob', 'birth date', 'born'], value: caseFile.dob },
    { patterns: ['address', 'residential', 'home address', 'living'], value: caseFile.address },
    { patterns: ['phone', 'telephone', 'mobile', 'contact no'], value: caseFile.phone },
    { patterns: ['income', 'monthly income', 'salary', 'earnings', 'wage'], value: caseFile.income || caseFile.financial },
    { patterns: ['employ', 'occupation', 'job', 'work'], value: caseFile.employment },
    { patterns: ['family size', 'family member', 'household', 'number of person'], value: caseFile.children },
    { patterns: ['sex', 'gender', 'male', 'female'], value: caseFile.sex },
    { patterns: ['marital', 'married', 'single', 'divorced'], value: caseFile.marital_status },
    { patterns: ['accommodation', 'housing type', 'type of housing'], value: caseFile.accommodation },
    { patterns: ['savings', 'asset', 'bank balance', 'deposit'], value: caseFile.savings },
    { patterns: ['reason', 'cssa reason', 'purpose', 'why'], value: caseFile.cssa_reason },
    { patterns: ['spouse', 'husband', 'wife', 'partner name'], value: caseFile.spouse_name },
    { patterns: ['spouse.*id', 'husband.*id', 'partner.*id', 'wife.*id'], value: caseFile.spouse_hkid, isRegex: true },
    { patterns: ['marriage date', 'date of marriage', 'wed'], value: caseFile.marriage_date },
    { patterns: ['marriage place', 'place of marriage', 'wed.*place'], value: caseFile.marriage_place },
    { patterns: ['maintenance', 'alimony', 'allowance'], value: caseFile.maintenance },
    { patterns: ['date', 'today', 'signed', 'signature date'], value: new Date().toLocaleDateString('en-HK') },
  ];

  for (const matcher of matchers) {
    for (const pattern of matcher.patterns) {
      const test = matcher.isRegex 
        ? new RegExp(pattern).test(key) 
        : key.includes(pattern);
      if (test && matcher.value) return String(matcher.value);
    }
  }
  return null;
}

// Smart fill: Gemini Vision detects fields → semantic match → fills PDF
app.post('/api/smart-fill', upload.single('pdf'), async (req, res) => {
  try {
    const caseFile = JSON.parse(req.body.caseFile || '{}');
    let pdfBuffer;
    let cacheKey;

    if (req.file) {
      // User uploaded any PDF
      pdfBuffer = req.file.buffer;
      cacheKey = req.file.originalname;
    } else {
      // Named form from legal_docs
      const { formType } = req.body;
      const fileMap = {
        cssa: 'CSSA_Registration_Form(e)_202302.pdf',
        marriage_search: 'request for search or marriage records.pdf',
      };
      const fileName = fileMap[formType];
      if (!fileName) return res.status(400).json({ error: 'Unknown formType and no PDF uploaded' });
      pdfBuffer = await fs.readFile(path.join(process.cwd(), 'legal_docs', fileName));
      cacheKey = fileName;
    }

    // Load PDF to get page dimensions
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width: pageWidth, height: pageHeight } = firstPage.getSize();

    // Detect fields — use cache to avoid calling Gemini repeatedly
    let fields;
    if (fieldPositionCache[cacheKey]) {
      console.log(`[SmartFill] Using cached fields for ${cacheKey}`);
      fields = fieldPositionCache[cacheKey];
    } else {
      console.log(`[SmartFill] Calling Gemini Vision to analyze ${cacheKey}...`);
      fields = await detectFieldsWithGemini(pdfBuffer, pageWidth, pageHeight);
      fieldPositionCache[cacheKey] = fields;
      console.log(`[SmartFill] Detected ${fields.length} fields, cached.`);
    }

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Fill each detected field
    const filled = [];
    const skipped = [];
    for (const field of fields) {
      const value = matchFieldToCaseFile(field.semantic_key, field.label_text || '', caseFile);
      if (!value) { skipped.push(field.semantic_key); continue; }

      // Convert from percentage (top-left origin) to pdf-lib points (bottom-left origin)
      const x = field.x_pct * pageWidth;
      const y = pageHeight - (field.y_pct * pageHeight) - 10; // -10 to sit on the line

      try {
        firstPage.drawText(value, { x, y, size: 9, font, color: rgb(0, 0, 0) });
        filled.push(field.semantic_key);
      } catch(e) {
        console.warn(`[SmartFill] Could not draw ${field.semantic_key}:`, e.message);
      }
    }

    console.log(`[SmartFill] Filled: ${filled.join(', ')} | Skipped: ${skipped.join(', ')}`);

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Zoya_SmartFill_${cacheKey}"`);
    res.setHeader('X-Fields-Filled', filled.join(','));
    res.setHeader('X-Fields-Skipped', skipped.join(','));
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('[SmartFill] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear field position cache (useful after uploading a new PDF version)
app.post('/api/smart-fill/clear-cache', (req, res) => {
  const { cacheKey } = req.body;
  if (cacheKey) delete fieldPositionCache[cacheKey];
  else Object.keys(fieldPositionCache).forEach(k => delete fieldPositionCache[k]);
  res.json({ cleared: true, remaining: Object.keys(fieldPositionCache) });
});

// New Endpoint for Local Autofilling (kept for backwards compatibility)
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
    
    // Direct mapping from caseFile to form fields (no AI needed)
    const mappedData = {};
    // Map all known caseFile keys to form field labels
    const fieldMap = {
      name: caseFile.name,
      hkid: caseFile.hkid,
      address: caseFile.address,
      phone: caseFile.phone,
      income: caseFile.income || caseFile.financial,
      employment: caseFile.employment,
      family_size: caseFile.children,
      date: caseFile.dob,
      spouse_name: caseFile.spouse_name,
      spouse_hkid: caseFile.spouse_hkid,
      marriage_date: caseFile.marriage_date,
      marriage_place: caseFile.marriage_place,
      sex: caseFile.sex,
      marital_status: caseFile.marital_status,
      accommodation: caseFile.accommodation,
      rent: caseFile.rent,
      savings: caseFile.savings,
      cssa_reason: caseFile.cssa_reason,
      maintenance: caseFile.maintenance,
      dob: caseFile.dob,
    };
    for (const field of fieldPositions) {
      if (fieldMap[field.label]) mappedData[field.label] = fieldMap[field.label];
    }

    // Load PDF and embed text at correct positions
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    
    // Draw text at field positions
    for (const field of fieldPositions) {
      const value = mappedData[field.label];
      if (value) {
        try {
          firstPage.drawText(String(value), {
            x: field.x,
            y: field.y,
            size: 9,
            font: font,
            color: rgb(0, 0, 0),
          });
        } catch(drawErr) {
          console.error(`Failed to draw field ${field.label}:`, drawErr.message);
        }
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
    
    // Direct mapping from caseFile
    const mappedData = {};
    const fieldMap = {
      name: caseFile.name, hkid: caseFile.hkid, address: caseFile.address,
      phone: caseFile.phone, income: caseFile.income || caseFile.financial,
      employment: caseFile.employment, family_size: caseFile.children,
      date: caseFile.dob, spouse_name: caseFile.spouse_name,
      spouse_hkid: caseFile.spouse_hkid, marriage_date: caseFile.marriage_date,
      marriage_place: caseFile.marriage_place, sex: caseFile.sex,
      marital_status: caseFile.marital_status, dob: caseFile.dob,
    };
    for (const field of fieldPositions) {
      if (fieldMap[field.label]) mappedData[field.label] = fieldMap[field.label];
    }

    // Load PDF and embed text
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    
    // Draw text at field positions
    for (const field of fieldPositions) {
      const value = mappedData[field.label];
      if (value) {
        try {
          firstPage.drawText(String(value), {
            x: field.x,
            y: field.y,
            size: 9,
            font: font,
            color: rgb(0, 0, 0),
          });
        } catch(drawErr) {
          console.error(`Preview draw failed for ${field.label}:`, drawErr.message);
        }
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
    // Truncated JSON repair: find the last complete object in the timeline array
    let fixedJson = jsonString;
    
    // Remove any trailing incomplete object (cut off mid-property)
    // Find the last complete "}" that closes a timeline entry
    const lastCompleteObj = fixedJson.lastIndexOf('}');
    if (lastCompleteObj > 0) {
      // Check if there's a trailing comma or incomplete content after the last }
      const afterLast = fixedJson.substring(lastCompleteObj + 1).trim();
      if (afterLast && !afterLast.startsWith(']') && !afterLast.startsWith('}')) {
        // Truncate to the last complete object
        fixedJson = fixedJson.substring(0, lastCompleteObj + 1);
      }
    }

    // Close any unclosed brackets/braces
    const openBraces = (fixedJson.match(/{/g) || []).length;
    const closeBraces = (fixedJson.match(/}/g) || []).length;
    const openBrackets = (fixedJson.match(/\[/g) || []).length;
    const closeBrackets = (fixedJson.match(/]/g) || []).length;

    // Remove trailing comma before closing
    fixedJson = fixedJson.replace(/,\s*$/, '');

    for (let i = 0; i < openBrackets - closeBrackets; i++) fixedJson += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixedJson += '}';

    try {
      return JSON.parse(fixedJson);
    } catch (fixError) {
      // Last resort: try to extract just the timeline array entries that are complete
      try {
        const timelineMatch = fixedJson.match(/"timeline"\s*:\s*\[([\s\S]*)/);
        if (timelineMatch) {
          let arr = '[' + timelineMatch[1];
          // Find all complete objects
          const objects = [];
          const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
          let m;
          while ((m = objRegex.exec(arr)) !== null) {
            try { objects.push(JSON.parse(m[0])); } catch(e) {}
          }
          if (objects.length > 0) {
            return { timeline: objects, language: 'en' };
          }
        }
      } catch(e) {}
      
      throw new Error(`Invalid JSON from Vertex AI even after attempting repairs. Raw response:\n${raw.substring(0, 500)}...`);
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

  const prompt = `You are a forensic domestic violence analyst. Extract ONLY significant abuse incidents from this conversation. DO NOT extract every day — only days with documented abuse, threats, coercion, controlling behavior, or other harm.

For each incident, provide:
1. The date (YYYY-MM-DD, or best guess)
2. A detailed summary of what happened
3. Abuse type classification using EXACTLY these categories (can be multiple):
   - "physical" (hitting, pushing, restraining, any physical force)
   - "emotional" (insults, humiliation, gaslighting, isolation)
   - "financial" (controlling money, preventing work, stealing assets)
   - "coercive_control" (monitoring, stalking, controlling daily activities, threats to control)
   - "sexual" (any non-consensual sexual behavior)
   - "threats" (threats of violence, threats to children, threats of self-harm as manipulation)
4. Key abuse indicators/keywords
5. Direct quotes from the conversation (verbatim, in quotation marks)

Return as JSON:
{
  "timeline": [
    {
      "date": "YYYY-MM-DD",
      "summary": "Detailed description of what happened",
      "abuse_types": ["physical", "threats"],
      "keywords": ["control", "threat", "isolation"],
      "quotes": [
        "Direct quote evidencing abuse",
        "Another relevant quote"
      ]
    }
  ],
  "language": "en|zh|yue"
}

CRITICAL RULES:
- Only include days with actual incidents
- Be precise with abuse_types — use the exact category names listed above
- Include ALL relevant quotes as direct evidence
- If a day has multiple types of abuse, list all of them
- Prioritize accuracy over completeness`;

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
            maxOutputTokens: 16000,
            topP: 0.95,
          },
        }
      : {
          instances: [{ content: `${prompt}\n\n${text}` }],
          parameters: {
            temperature: 0.0,
            maxOutputTokens: 16000,
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

// Generate a complete case pack for solicitor
app.post('/api/generate-case-pack', async (req, res) => {
  try {
    const { caseFile, docDatabase, documentType } = req.body;
    
    let packPrompt;
    let docTitle;
    
    if (documentType === 'Legal Aid Application') {
      docTitle = 'LEGAL AID APPLICATION';
      packPrompt = `Generate a pre-filled Legal Aid application for a domestic violence case in Hong Kong.

Case File: ${JSON.stringify(caseFile)}

Include:
1. Applicant details (name, HKID, address, phone)
2. Financial means test (income, assets — threshold HK$452,320)
3. Nature of proceedings: Application for Non-Molestation Order under DCRVO Cap. 189
4. Grounds for application: domestic violence (summarize from case file)
5. Urgency assessment
6. Declaration

Format as a formal Legal Aid Department application.`;
    } else if (documentType && documentType.includes('Injunction')) {
      docTitle = 'INJUNCTION APPLICATION — DCRVO CAP. 189';
      packPrompt = `Generate a draft injunction application (Non-Molestation Order) under the Domestic and Cohabitation Relationships Violence Ordinance (Cap. 189) for the Hong Kong Family Court.

Case File: ${JSON.stringify(caseFile)}

Include:
1. Court header: Family Court of the High Court of Hong Kong
2. Applicant and Respondent details
3. Grounds for application (abuse history from case file)
4. Orders sought (non-molestation, exclusion if applicable)
5. Whether ex parte application is appropriate
6. Supporting affidavit summary
7. List of exhibits/evidence

Format as a formal court application document.`;
    } else {
      docTitle = 'ZOYA CASE PACK — CONFIDENTIAL';
      packPrompt = `Generate a professional case summary document for a domestic violence solicitor in Hong Kong.

Case File: ${JSON.stringify(caseFile)}
Documents on file: ${JSON.stringify(docDatabase?.map(d => d.name) || [])}

Create a structured legal brief including:
1. Client Information Summary
2. Safety Assessment
3. Financial Situation
4. Documents Collected
5. Recommended Legal Actions (specific to HK law — DCRVO, Legal Aid, etc.)
6. Immediate Next Steps

Format it professionally as a solicitor would expect.`;
    }

    const result = await generateAIResponse([{ role: 'user', text: packPrompt }], 
      'You are a Hong Kong family law legal assistant. Generate professional case documentation.', false);
    
    // Generate as PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const lines = result.split('\n');
    let page = pdfDoc.addPage([595, 842]); // A4
    let y = 800;
    const margin = 50;
    const maxWidth = 495;
    
    // Title
    page.drawText(docTitle || 'ZOYA CASE PACK — CONFIDENTIAL', { x: margin, y, size: 14, font: boldFont, color: rgb(0.4, 0.2, 0.8) });
    y -= 20;
    page.drawText(`Generated: ${new Date().toLocaleString('en-GB')}`, { x: margin, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 30;
    
    for (const line of lines) {
      if (y < 60) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }
      const isHeader = line.startsWith('#') || line.startsWith('**');
      const cleanLine = line.replace(/[#*]/g, '').trim();
      if (!cleanLine) { y -= 10; continue; }
      
      const fontSize = isHeader ? 11 : 9;
      const usedFont = isHeader ? boldFont : font;
      
      // Simple word wrap
      const words = cleanLine.split(' ');
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = usedFont.widthOfTextAtSize(testLine, fontSize);
        if (width > maxWidth && currentLine) {
          page.drawText(currentLine, { x: margin, y, size: fontSize, font: usedFont, color: rgb(0.1, 0.1, 0.1) });
          y -= fontSize + 4;
          if (y < 60) { page = pdfDoc.addPage([595, 842]); y = 800; }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        page.drawText(currentLine, { x: margin, y, size: fontSize, font: usedFont, color: rgb(0.1, 0.1, 0.1) });
        y -= fontSize + 4;
      }
    }
    
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Zoya_Case_Pack.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Case pack error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Zoya HK Backend running on port ${PORT}`));
