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
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure local vault directory exists for storage
const vaultDir = path.join(__dirname, 'legal_docs', 'vault');
fs.mkdir(vaultDir, { recursive: true }).catch(console.error);
app.use('/vault', express.static(vaultDir));

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

// ===== FILL-TEMPLATE: overlay case data onto the actual government PDF forms =====
// Strategy: sips (macOS built-in) renders the PDF to PNG, bypassing pdf-lib's
// inability to parse corrupted xref tables. Anvil then generates a new PDF
// with the original form as a full-page background and case data text precisely
// overlaid using the calibrated getDefaultFields() coordinates.

async function pdfToBase64PNG(pdfPath) {
  const tmpPng = path.join(process.cwd(), 'legal_docs', `_tmp_${Date.now()}.png`);
  try {
    // sips uses macOS CoreGraphics — handles corrupted/legacy PDFs reliably
    await execAsync(`sips --setProperty format png "${pdfPath}" --out "${tmpPng}"`);
    const buf = await fs.readFile(tmpPng);
    return buf.toString('base64');
  } finally {
    await fs.unlink(tmpPng).catch(() => {});
  }
}

// PDF page dimensions in points — A4
const PDF_W = 595.32;
const PDF_H = 841.92;

// Convert pdf-lib coords (x, y from BOTTOM-LEFT in points) to CSS % (from TOP-LEFT)
function toCSS(x, y) {
  return {
    left: `${((x / PDF_W) * 100).toFixed(2)}%`,
    top:  `${(((PDF_H - y - 9) / PDF_H) * 100).toFixed(2)}%`,  // -9 ≈ font cap height
  };
}

function buildOverlayHtml(formType, caseFile, base64Png) {
  const fields = getDefaultFields(formType);
  const valueMap = {
    name:          caseFile.name,
    hkid:          caseFile.hkid,
    dob:           caseFile.dob,
    address:       caseFile.address,
    employment:    caseFile.employment,
    income:        caseFile.income || caseFile.financial,
    phone:         caseFile.phone,
    family_size:   caseFile.children,
    date:          caseFile.dob || new Date().toLocaleDateString('en-HK'),
    spouse_name:   caseFile.spouse_name,
    spouse_hkid:   caseFile.spouse_hkid,
    marriage_date: caseFile.marriage_date,
    marriage_place:caseFile.marriage_place,
  };

  const overlayItems = fields
    .map(f => {
      const value = valueMap[f.label];
      if (!value) return '';
      const { left, top } = toCSS(f.x, f.y);
      return `<span class="field" style="left:${left};top:${top}">${String(value).replace(/</g,'&lt;')}</span>`;
    })
    .join('\n');

  return {
    html: `
      <div class="page">
        <img class="bg" src="data:image/png;base64,${base64Png}" />
        ${overlayItems}
      </div>`,
    css: `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { width: ${PDF_W}pt; height: ${PDF_H}pt; overflow: hidden; }
      .page { position: relative; width: ${PDF_W}pt; height: ${PDF_H}pt; }
      .bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
      .field {
        position: absolute;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9pt;
        color: #000;
        white-space: nowrap;
        line-height: 1;
      }
    `,
  };
}

app.post('/api/fill-template', async (req, res) => {
  try {
    const { formType, caseFile } = req.body;
    const apiKey = process.env.ANVIL_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANVIL_API_KEY not set in .env' });

    const fileMap = {
      cssa:            'CSSA_Registration_Form(e)_202302.pdf',
      marriage_search: 'request for search or marriage records.pdf',
    };
    const fileName = fileMap[formType];
    if (!fileName) return res.status(400).json({ error: 'Unknown formType' });

    const pdfPath = path.join(process.cwd(), 'legal_docs', fileName);

    console.log(`[FillTemplate] Converting ${fileName} to PNG via sips...`);
    let base64Png;
    try {
      base64Png = await pdfToBase64PNG(pdfPath);
    } catch(e) {
      return res.status(500).json({ error: `PDF→PNG conversion failed: ${e.message}. Ensure sips is available (macOS).` });
    }

    const { html, css } = buildOverlayHtml(formType, caseFile, base64Png);

    console.log(`[FillTemplate] Sending to Anvil for PDF rendering...`);
    const anvilRes = await fetch('https://app.useanvil.com/api/v1/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        'Accept': 'application/pdf',
      },
      body: JSON.stringify({
        title: `Zoya — ${formType} filled form`,
        type: 'html',
        page: {
          width: `${PDF_W}pt`,
          height: `${PDF_H}pt`,
          margin: '0',
        },
        data: { html, css },
      }),
    });

    if (!anvilRes.ok) {
      const errText = await anvilRes.text();
      return res.status(anvilRes.status).json({ error: `Anvil error: ${errText.slice(0, 200)}` });
    }

    const pdfBuffer = Buffer.from(await anvilRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Zoya_Filled_${fileName}"`);
    res.send(pdfBuffer);

    console.log(`[FillTemplate] Done — ${pdfBuffer.length} bytes returned.`);
  } catch(err) {
    console.error('[FillTemplate] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== AGENT: FETCH LIVE PDF INTO ZOYA =====
app.post('/api/agent/fetch-doc', async (req, res) => {
  try {
    const { url, docId } = req.body;
    if (!url || !docId) return res.status(400).json({ error: 'Missing url or docId' });

    console.log(`[Fetch Agent] Agent fetching document from ${url}...`);
    const fetchRes = await fetch(url);
    
    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `Agent failed to fetch: ${fetchRes.statusText}` });
    }

    const buffer = await fetchRes.arrayBuffer();
    const fileName = `${docId}_fetched_${Date.now()}.pdf`;
    const savePath = path.join(process.cwd(), 'legal_docs', fileName);

    await fs.writeFile(savePath, Buffer.from(buffer));
    console.log(`[Fetch Agent] Successfully saved to ${savePath}`);

    // Return the relative URL so the frontend can download/preview it from the server
    // Since we're not serving legal_docs statically directly, we can just send the file back immediately as an attachment.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${docId}_Official.pdf"`);
    res.send(Buffer.from(buffer));

  } catch (error) {
    console.error('[Fetch Agent] Autonomy error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ===== SECURE VAULT ENDPOINTS ===== */
app.post('/api/vault/analyze', async (req, res) => {
  try {
    const { imageBase64, mimeType, contextText } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

    // No AI processing needed for the vault ingestion stream anymore. 
    // We just take the user's description.
    const analysis = contextText || 'User-provided photograph evidence.';

    // Permanently persist the image to the local Node vault directory
    const buffer = Buffer.from(imageBase64, 'base64');
    let ext = '.jpg';
    if (mimeType?.includes('png')) ext = '.png';
    else if (mimeType?.includes('pdf')) ext = '.pdf';
    
    const fileName = `evidence_${Date.now()}_${Math.random().toString(36).substring(2,8)}${ext}`;
    const filePath = path.join(vaultDir, fileName);
    await fs.writeFile(filePath, buffer);
    
    // Serve the image via the static vault route
    const storageUrl = `http://localhost:3001/vault/${fileName}`;

    res.json({ analysis: analysis.trim(), storageUrl });
  } catch (error) {
    console.error('[Vault Analyze] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/compile-case-package', async (req, res) => {
  try {
    const { vaultItems = [], messages = [], caseFile = {}, whatsappTimeline = null } = req.body;
    const textGenModel = vertexAI.preview.getGenerativeModel({ model: textModel, generationConfig: { temperature: 0.1 } });

    // Stringify the memory context
    // 1. FILTER: We EXCLUDE the virtual 'TXT LOG' items from the Forensic Evidence manifest.
    // This forces the LLM to use the curated 'EXTRACTED WHATSAPP CHRONOLOGY' block instead of 
    // seeing a generic "txt file" in the vault and writing "content to be reviewed".
    const physicalEvidence = vaultItems.filter(item => 
      !item.dataUrl.startsWith('data:image/svg+xml') && 
      !item.analysis.toLowerCase().includes('extracted')
    );
    
    const evidenceContext = physicalEvidence.map((item, idx) => `Evidence Item ${idx+1}:
- Victim Context: ${item.contextText}
- Forensic Finding: ${item.analysis}
- REFERENCE_URL: ${item.dataUrl}`).join('\n\n');

    const chatContext = messages.filter(m => m.role === 'user' || m.role === 'agent').map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
    const profileContext = JSON.stringify(caseFile, null, 2);
    
    let timelineContext = 'NO EXTERNAL CHAT EXPORT DATA PROVIDED.';
    if (whatsappTimeline && whatsappTimeline.timeline && whatsappTimeline.timeline.length > 0) {
      timelineContext = whatsappTimeline.timeline.map(t => {
        const types = Array.isArray(t.abuse_types) ? t.abuse_types.join(', ') : 'unknown';
        const msg = (t.quotes && t.quotes[0]) ? t.quotes[0] : (t.message || 'Verbatim quote missing');
        return `DANGER EVENT [Date: ${t.date || 'Undated'}]:
    THREAT CLASSIFICATION: ${types.toUpperCase()}
    INCIDENT SUMMARY: ${t.summary || 'No summary provided.'}
    VERBATIM QUOTE: "${msg}"`;
      }).join('\n---\n');
    }

    const masterContext = `
[SYSTEM MEMORY: LEGAL CASEFILE]

=== SECTION 1: VICTIM PROFILE ===
${profileContext}

=== SECTION 2: HIGH-FIDELITY CHAT CHRONOLOGY (PRIMARY LEGAL EVIDENCE) ===
${timelineContext}

=== SECTION 3: RECENT CHAT WITH ZOYA ===
${chatContext}

=== SECTION 4: FORENSIC VAULT (PHOTOS/SCAN ATTACHMENTS) ===
${evidenceContext}
`;

    // Agent 1: Injunction Letter Prompter
    const pInjunction = textGenModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: `
You are drafting a formal Domestic Violence Injunction Affidavit (Non-Molestation / Ouster Order) for Hong Kong Courts.
MANDATORY FAIL-SAFE: The very first line of your output MUST be a centered <h1> title: "AFFIDAVIT OF [APPLICANT NAME]". DO NOT FORGET THE TITLE.

Using the memory context below, draft a highly formal, legal affidavit in HTML. 
DO NOT INCLUDE RAW "LOCALHOST" URLS. 
Refer to evidence as "Exhibit [Number]".
Focus heavily on the specific dates and verbatim messages described in 'SECTION 2: HIGH-FIDELITY CHAT CHRONOLOGY'. These are your primary forensic proof.

MEMORY STATE:
${masterContext}
`}]}]
    });

    // Agent 2: Chronology Prompter
    const pChronology = textGenModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: `
You are an objective legal compiler generating a Court Chronology of Abuse for Hong Kong Family Court.
YOUR OUTPUT MUST START WITH: <h1 style="text-align:center;">STATUTORY CHRONOLOGY OF EVENTS</h1>

Using ONLY SECTION 2, SECTION 3, and SECTION 4, generate a chronological HTML table.
Table Columns: [Date/Time], [Incident Description], [Reference].

COLUMN MAPPING RULES:
1. [Date/Time]: Use the date provided in the "DANGER EVENT" block.
2. [Incident Description]: Combine the "THREAT CLASSIFICATION" with the "INCIDENT SUMMARY" provided in high-fidelity chronology. 
   Example: "COERCIVE CONTROL: Respondent monitored Applicant's phone and threatened to restrict her movement."
3. [Reference]: You MUST use the "VERBATIM QUOTE" text. Do not summarize it. Write it exactly.

MEMORY STATE:
${masterContext}
`}]}]
    });

    // Agent 3: Case Pack Manifest Prompter
    const pCasePack = textGenModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: `
You are generating the "Master Evidence Case Pack" manifest.
MANDATORY FAIL-SAFE: The very first line of your output MUST be a centered <h1> title: "MASTER EVIDENCE CASE PACK MANIFEST". DO NOT FORGET THE TITLE.

Format as a professional Legal Brief overview using ONLY formatted HTML tags.
CRITICAL INSTRUCTION: When mentioning a photo/document FROM 'SECTION 4', you MUST embed the image using an <img> tag.
DO NOT PRINT THE URL AS TEXT. ONLY USE IT IN THE SRC ATTRIBUTE of the <img> tag.
MEMORY STATE:
${masterContext}
`}]}]
    });

    // Wait for all 3 agents to finish compiling simultaneously
    const [injunctionRes, chronologyRes, packRes] = await Promise.all([pInjunction, pChronology, pCasePack]);

    const getResText = (r) => {
      const text = r.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text.trim();
    };

    // Forcefully strip Gemini's stubborn conversational markdown blocks and convert native markdown to standard HTML tags
    const parseMarkdownToHTML = (text) => {
      if (!text) return '';
      
      const tableStyles = `
        <style>
          table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 0.85rem; }
          th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; vertical-align: top; }
          th { background-color: #f8fafc; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
          tr:nth-child(even) { background-color: #fcfcfc; }
        </style>
      `;

      // Strip starting/ending markdown blocks and trim leading/trailing whitespace
      let html = text.replace(/```(markdown|html)?\n/gi, '').replace(/```/g, '').trim();
      
      // COLLAPSE EXCESS NEWLINES: Replace clusters of 3+ newlines with just 2 newlines
      html = html.replace(/\n{3,}/g, '\n\n');

      html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
      html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
      html = html.replace(/^### (.*$)/gim, '<h3 style="margin-top:0; margin-bottom:5px; font-family:Outfit, sans-serif;">$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2 style="margin-top:0; margin-bottom:10px; font-size:1.1rem; color:#1e293b; font-family:Outfit, sans-serif;">$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1 style="margin-top:0; margin-bottom:15px; font-size:1.3rem; color:#0f172a; text-transform:uppercase; font-family:Outfit, sans-serif; text-align:center;">$1</h1>');
      
      // Convert remaining newlines into structured elements
      // We protect HTML blocks (tables, headers, lists) from being wrapped in redundant <br/> tags
      html = html.split('\n\n').map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        
        // If it looks like a block-level HTML element, don't wrap it or inject <br/>
        if (trimmed.startsWith('<h') || trimmed.startsWith('<table') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<div')) {
           return trimmed;
        }
        
        // Only wrap plain text blocks
        return `<div style="margin-bottom:12px;">${trimmed.replace(/\n/g, '<br/>')}</div>`;
      }).join('');
      
      return tableStyles + html;
    };

    res.json({
      injunction: parseMarkdownToHTML(getResText(injunctionRes)),
      chronology: parseMarkdownToHTML(getResText(chronologyRes)),
      casePack:    parseMarkdownToHTML(getResText(packRes))
    });
  } catch (error) {
    console.error('[Compile Package] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/draft-official-form', async (req, res) => {
  try {
    const { docId, caseFile } = req.body;
    if (!docId) return res.status(400).json({ error: 'Missing docId' });

    const textGenModel = vertexAI.preview.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.2 } });

    console.log(`[Draft Form] Gemini drafting secure ephemeral HTML form for ${docId}...`);
    
    let formName = docId;
    if (docId === 'cssa') formName = 'Comprehensive Social Security Assistance (CSSA) Scheme Application';
    else if (docId === 'legal_aid') formName = 'Legal Aid Pre-application Information Form';
    else if (docId === 'housing') formName = 'Public Rental Housing Application';
    else if (docId === 'marriage') formName = 'Search for Marriage Record (Form MR35)';

    const prompt = `You are a legal forms processing agent.
Your task is to generate an interactive, clean HTML representation of the formal Hong Kong "${formName}".
It must NOT look like conversational text. It must look like a physical paper form converted to HTML.
Use <h1>, <h2>, <p>, <b>, and layout it formally. 
CRITICAL: Visually pre-fill the form using the user's data below where applicable. If data is unknown, insert blank underlines ______.

User Data:
${JSON.stringify(caseFile || {}, null, 2)}

OUTPUT ONLY VALID HTML WITHOUT ANY MARKDOWN (NO \`\`\`html).`;

    const generated = await textGenModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    let html = generated.response.candidates[0].content.parts[0].text;
    html = html.replace(/```(html|markdown)?\n/gi, '').replace(/```/g, '');

    res.json({ html, title: formName });
  } catch (error) {
    console.error('[Draft Form] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
// Cache cleared on each server start so prompt changes take effect immediately
const fieldPositionCache = {};
const SMART_FILL_DEBUG = process.env.SMART_FILL_DEBUG === 'true';

// Ask Gemini Vision to read the PDF and return field positions as percentages
async function detectFieldsWithGemini(pdfBuffer, pageWidth, pageHeight) {
  const pdfBase64 = pdfBuffer.toString('base64');

  const model = vertexAI.preview.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `You are a precise form-field locator agent. Analyze this government PDF form.

Your ONLY job: find every blank space where a person writes their answer.

For each blank field, return:
- "semantic_key": snake_case label (e.g. "applicant_name", "hkid_number", "date_of_birth", "home_address", "phone_number", "monthly_income", "employment", "spouse_name", "marriage_date", "number_of_children")
- "label_text": the exact printed label adjacent to this blank
- "x_pct": proportion of PAGE WIDTH (0.0=left edge, 1.0=right edge) for where to BEGIN writing the answer — this should be INSIDE the blank box or on the blank line, NOT at the label
- "y_pct": proportion of PAGE HEIGHT from TOP (0.0=top, 1.0=bottom) for the VERTICAL CENTRE of the blank line/box
- "field_type": "text" | "date" | "number" | "checkbox"

CRITICAL positioning rules:
1. x_pct must point INSIDE the blank area — if the label is on the left and the blank is to the right, x_pct should be where the blank starts (right side)
2. y_pct must point to the CENTRE of the blank line/box — not the label, not above/below it
3. The page is ${Math.round(pageWidth)} points wide × ${Math.round(pageHeight)} points tall
4. Only include fields that need user-provided data
5. Skip headers, instructions, section titles, page numbers

Example: For a row that looks like "Date of Birth: [__________]", if the blank box starts at 40% from left and is at 15% from top:
  {"semantic_key":"date_of_birth","label_text":"Date of Birth","x_pct":0.42,"y_pct":0.15,"field_type":"date"}

Return ONLY a JSON array, no markdown, no explanation:
[{"semantic_key":"...","label_text":"...","x_pct":0.0,"y_pct":0.0,"field_type":"text"}, ...]`;

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

      // Convert from percentage + top-left origin → pdf-lib bottom-left points
      // y_pct=0 is top of page, y_pct=1 is bottom
      // pdf-lib y=0 is bottom, y=pageHeight is top
      // We subtract 3 (half text cap height for 9pt font) so text sits centred on the line
      const x = field.x_pct * pageWidth;
      const y = pageHeight - (field.y_pct * pageHeight) - 3;

      // Clamp to page bounds
      const safeX = Math.max(5, Math.min(x, pageWidth - 50));
      const safeY = Math.max(5, Math.min(y, pageHeight - 10));

      if (SMART_FILL_DEBUG) {
        // Draw a small red dot at the target position for visual debugging
        firstPage.drawCircle({ x: safeX, y: safeY, size: 3, color: rgb(1, 0, 0) });
      }

      try {
        firstPage.drawText(value, { x: safeX, y: safeY, size: 9, font, color: rgb(0, 0, 0) });
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

// Clear field position cache
app.post('/api/smart-fill/clear-cache', (req, res) => {
  const { cacheKey } = req.body;
  if (cacheKey) delete fieldPositionCache[cacheKey];
  else Object.keys(fieldPositionCache).forEach(k => delete fieldPositionCache[k]);
  res.json({ cleared: true, remaining: Object.keys(fieldPositionCache) });
});

// Debug endpoint: returns PDF with RED DOTS at every Gemini-detected field position
// Use this to visually verify coordinate accuracy before filling
app.post('/api/smart-fill/debug', upload.single('pdf'), async (req, res) => {
  try {
    let pdfBuffer, cacheKey;
    if (req.file) {
      pdfBuffer = req.file.buffer; cacheKey = req.file.originalname;
    } else {
      const { formType } = req.body;
      const fileMap = { cssa: 'CSSA_Registration_Form(e)_202302.pdf', marriage_search: 'request for search or marriage records.pdf' };
      const fileName = fileMap[formType];
      if (!fileName) return res.status(400).json({ error: 'Unknown formType' });
      pdfBuffer = await fs.readFile(path.join(process.cwd(), 'legal_docs', fileName));
      cacheKey = fileName;
    }

    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const firstPage = pdfDoc.getPages()[0];
    const { width: pageWidth, height: pageHeight } = firstPage.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Always re-detect (ignore cache) so debug reflects latest prompt
    console.log(`[SmartFill/Debug] Re-running Gemini Vision on ${cacheKey}...`);
    const fields = await detectFieldsWithGemini(pdfBuffer, pageWidth, pageHeight);
    // Update cache with latest
    fieldPositionCache[cacheKey] = fields;

    // Draw a RED CIRCLE + label at each detected field position
    for (const field of fields) {
      const x = field.x_pct * pageWidth;
      const y = pageHeight - (field.y_pct * pageHeight) - 3;
      const safeX = Math.max(5, Math.min(x, pageWidth - 50));
      const safeY = Math.max(5, Math.min(y, pageHeight - 10));

      // Red dot
      firstPage.drawCircle({ x: safeX, y: safeY + 4, size: 5, color: rgb(1, 0, 0) });
      // Field label in red
      firstPage.drawText(field.semantic_key, {
        x: Math.max(5, safeX - 20), y: safeY + 8,
        size: 6, font, color: rgb(0.9, 0, 0)
      });
    }

    const debugBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DEBUG_${cacheKey}"`);
    res.setHeader('X-Field-Count', fields.length);
    res.setHeader('X-Fields', fields.map(f => f.semantic_key).join(','));
    res.send(Buffer.from(debugBytes));
  } catch(e) {
    console.error('[SmartFill/Debug] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== ANVIL FORM FILL =====
// Generates pixel-perfect PDFs using Anvil's HTML→PDF API.
// No coordinate guessing — we build the form as HTML and Anvil renders it.

function buildCSSAHtml(cf) {
  const field = (label, value) => `
    <tr>
      <td class="label">${label}</td>
      <td class="value">${value || '<span class="empty">—</span>'}</td>
    </tr>`;

  return {
    html: `
    <div class="header">
      <div class="logo-area">
        <div class="logo-text">SWD</div>
        <div class="logo-sub">Social Welfare Department</div>
      </div>
      <div class="title-area">
        <h1>Comprehensive Social Security Assistance</h1>
        <h2>Application Form (CSSA)</h2>
        <p class="subtitle">Prepared by Zoya Advocate AI · ${new Date().toLocaleDateString('en-HK')}</p>
      </div>
    </div>

    <div class="section">
      <h3>PART A — PERSONAL PARTICULARS</h3>
      <table>${[
        field('Full Name (English)', cf.name),
        field('Hong Kong Identity Card No.', cf.hkid),
        field('Date of Birth', cf.dob),
        field('Sex', cf.sex),
        field('Marital Status', cf.marital_status),
        field('Residential Address', cf.address),
        field('Contact Phone Number', cf.phone),
      ].join('')}</table>
    </div>

    <div class="section">
      <h3>PART B — HOUSEHOLD INFORMATION</h3>
      <table>${[
        field('Number of Household Members', cf.children),
        field('Accommodation Type', cf.accommodation),
        field('Monthly Rent / Housing Cost', cf.rent),
      ].join('')}</table>
    </div>

    <div class="section">
      <h3>PART C — FINANCIAL CIRCUMSTANCES</h3>
      <table>${[
        field('Monthly Income / Employment', cf.income || cf.financial),
        field('Employment Status', cf.employment),
        field('Total Assets / Savings', cf.savings),
        field('Monthly Maintenance Received', cf.maintenance),
        field('Reason for CSSA Application', cf.cssa_reason || 'Domestic violence — leaving abusive household'),
      ].join('')}</table>
    </div>

    <div class="section declaration">
      <h3>DECLARATION</h3>
      <p>I declare that the information given in this application is true and correct to the best of my knowledge and belief. I understand that any false information may render me liable to prosecution.</p>
      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-label">Signature of Applicant</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">${new Date().toLocaleDateString('en-HK')}</div>
          <div class="sig-label">Date</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>For official use only · Social Welfare Department · Hong Kong SAR Government</p>
      <p>Confidential — prepared by Zoya Advocate AI · Do not distribute</p>
    </div>`,
    css: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
      body { font-family: 'Inter', 'Noto Sans', 'Noto CJK', sans-serif; font-size: 11px; color: #1e293b; margin: 0; }
      .header { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 20px; border-bottom: 3px solid #8b6f5c; padding-bottom: 14px; }
      .logo-area { background: #8b6f5c; color: white; padding: 10px 14px; border-radius: 8px; text-align: center; min-width: 60px; }
      .logo-text { font-size: 20px; font-weight: 700; }
      .logo-sub { font-size: 7px; margin-top: 2px; opacity: 0.85; }
      .title-area h1 { margin: 0 0 2px; font-size: 16px; color: #8b6f5c; }
      .title-area h2 { margin: 0 0 4px; font-size: 12px; color: #64748b; font-weight: 600; }
      .subtitle { margin: 0; font-size: 9px; color: #94a3b8; }
      .section { margin-bottom: 18px; }
      .section h3 { font-size: 10px; font-weight: 700; color: #8b6f5c; border-bottom: 1px solid #e2ddd5; padding-bottom: 4px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
      td.label { width: 40%; color: #64748b; font-weight: 600; }
      td.value { color: #1e293b; font-weight: 400; }
      .empty { color: #cbd5e1; font-style: italic; }
      .declaration { background: #fafaf9; border: 1px solid #e2ddd5; border-radius: 8px; padding: 14px; }
      .declaration p { line-height: 1.6; color: #475569; margin: 0 0 14px; }
      .sig-row { display: flex; gap: 40px; margin-top: 20px; }
      .sig-box { flex: 1; }
      .sig-line { border-bottom: 1px solid #334155; height: 28px; font-size: 11px; padding-bottom: 4px; color: #1e293b; }
      .sig-label { font-size: 9px; color: #94a3b8; margin-top: 4px; }
      .footer { border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; color: #94a3b8; font-size: 8px; }
      .footer p { margin: 2px 0; }
    `
  };
}

function buildMarriageHtml(cf) {
  const field = (label, value) => `
    <tr>
      <td class="label">${label}</td>
      <td class="value">${value || '<span class="empty">—</span>'}</td>
    </tr>`;

  return {
    html: `
    <div class="header">
      <div class="logo-area"><div class="logo-text">ImmD</div><div class="logo-sub">Immigration Dept</div></div>
      <div class="title-area">
        <h1>Request for Search of Marriage Records</h1>
        <h2>Immigration Department · Hong Kong SAR</h2>
        <p class="subtitle">Prepared by Zoya Advocate AI · ${new Date().toLocaleDateString('en-HK')}</p>
      </div>
    </div>
    <div class="section">
      <h3>APPLICANT DETAILS</h3>
      <table>${[
        field('Full Name of Applicant', cf.name),
        field('HKID Number', cf.hkid),
      ].join('')}</table>
    </div>
    <div class="section">
      <h3>MARRIAGE RECORD SOUGHT</h3>
      <table>${[
        field('Name of Spouse / Party', cf.spouse_name),
        field('HKID of Spouse', cf.spouse_hkid),
        field('Date of Marriage', cf.marriage_date),
        field('Place of Marriage', cf.marriage_place),
      ].join('')}</table>
    </div>
    <div class="section declaration">
      <h3>DECLARATION</h3>
      <p>I declare that I am entitled to obtain the record and the information provided is true and correct.</p>
      <div class="sig-row">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">Signature</div></div>
        <div class="sig-box"><div class="sig-line">${new Date().toLocaleDateString('en-HK')}</div><div class="sig-label">Date</div></div>
      </div>
    </div>
    <div class="footer"><p>Immigration Department · Hong Kong SAR Government · Confidential</p><p>Prepared by Zoya Advocate AI</p></div>`,
    css: `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
      body { font-family: 'Inter', 'Noto Sans', 'Noto CJK', sans-serif; font-size: 11px; color: #1e293b; margin: 0; }
      .header { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 20px; border-bottom: 3px solid #1e40af; padding-bottom: 14px; }
      .logo-area { background: #1e40af; color: white; padding: 10px 14px; border-radius: 8px; text-align: center; min-width: 60px; }
      .logo-text { font-size: 16px; font-weight: 700; }
      .logo-sub { font-size: 7px; margin-top: 2px; opacity: 0.85; }
      .title-area h1 { margin: 0 0 2px; font-size: 16px; color: #1e40af; }
      .title-area h2 { margin: 0 0 4px; font-size: 12px; color: #64748b; font-weight: 600; }
      .subtitle { margin: 0; font-size: 9px; color: #94a3b8; }
      .section { margin-bottom: 18px; }
      .section h3 { font-size: 10px; font-weight: 700; color: #1e40af; border-bottom: 1px solid #dbeafe; padding-bottom: 4px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
      td.label { width: 40%; color: #64748b; font-weight: 600; }
      td.value { color: #1e293b; }
      .empty { color: #cbd5e1; font-style: italic; }
      .declaration { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; }
      .declaration p { line-height: 1.6; color: #475569; margin: 0 0 14px; }
      .sig-row { display: flex; gap: 40px; margin-top: 20px; }
      .sig-box { flex: 1; }
      .sig-line { border-bottom: 1px solid #334155; height: 28px; font-size: 11px; padding-bottom: 4px; color: #1e293b; }
      .sig-label { font-size: 9px; color: #94a3b8; margin-top: 4px; }
      .footer { border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; color: #94a3b8; font-size: 8px; }
      .footer p { margin: 2px 0; }
    `
  };
}

app.post('/api/anvil-fill', async (req, res) => {
  try {
    const { formType, caseFile } = req.body;
    const apiKey = process.env.ANVIL_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANVIL_API_KEY not set in .env' });

    let htmlData;
    let title;
    if (formType === 'cssa') {
      htmlData = buildCSSAHtml(caseFile);
      title = 'CSSA Application — Prepared by Zoya';
    } else if (formType === 'marriage_search') {
      htmlData = buildMarriageHtml(caseFile);
      title = 'Marriage Record Search — Prepared by Zoya';
    } else {
      return res.status(400).json({ error: 'Unknown formType. Use cssa or marriage_search.' });
    }

    const payload = {
      title,
      type: 'html',
      page: { width: '8.27in', height: '11.69in', margin: '48px', marginTop: '36px', marginBottom: '36px' },
      data: { html: htmlData.html, css: htmlData.css },
    };

    // Call Anvil generate-pdf REST endpoint directly (simpler than SDK for ESM)
    const anvilRes = await fetch('https://app.useanvil.com/api/v1/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        'Accept': 'application/pdf',
      },
      body: JSON.stringify(payload),
    });

    if (!anvilRes.ok) {
      const errText = await anvilRes.text();
      console.error('[Anvil] Error:', anvilRes.status, errText);
      return res.status(anvilRes.status).json({ error: `Anvil error ${anvilRes.status}: ${errText.slice(0, 200)}` });
    }

    const pdfBuffer = Buffer.from(await anvilRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Zoya_Anvil_${formType}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[Anvil] Exception:', err);
    res.status(500).json({ error: err.message });
  }
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
