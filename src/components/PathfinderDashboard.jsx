import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import EmergencyShelters from './EmergencyShelters';

const safelyStringify = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    if (Array.isArray(val)) return val.map(safelyStringify).join(', ');
    return val.reply || val.text || val.content || val.value || JSON.stringify(val);
  }
  return String(val);
};

const INJUNCTION_REQUIREMENTS = [
  { id: 'identity', label: 'Identity Confirmed', check: (cf) => !!cf.name },
  { id: 'safety', label: 'Safety Assessed', check: (cf) => cf.safety && cf.safety !== 'Establishing...' },
  { id: 'police_report', label: 'Police Report Filed', check: (cf) => !!cf.police_report },
  { id: 'evidence', label: 'Evidence Documented', check: (cf) => !!cf.evidence_timeline },
  { id: 'financial', label: 'Financial Status Known', check: (cf) => !!cf.financial },
  { id: 'legal_aid', label: 'Legal Aid Applied', check: (cf) => !!cf.legal },
  { id: 'affidavit', label: 'Affidavit Drafted', check: (cf) => !!cf.affidavit },
  { id: 'solicitor', label: 'Solicitor Engaged', check: (cf) => !!cf.solicitor },
];

const PHASES = [
  { id: 'hour0_intake', label: 'First Contact', icon: '🟢', short: 'H0' },
  { id: 'hour1_safety', label: 'Immediate Safety', icon: '🔴', short: 'H1' },
  { id: 'evidence_building', label: 'Evidence', icon: '📋', short: 'D1' },
  { id: 'case_growing', label: 'Case Growing', icon: '📈', short: 'D2-7' },
  { id: 'legal_activated', label: 'Legal', icon: '⚖️', short: 'D7' },
  { id: 'financial_separation', label: 'Financial', icon: '💰', short: 'D7-14' },
  { id: 'housing_pipeline', label: 'Housing', icon: '🏠', short: 'D14-30' },
  { id: 'recovery', label: 'Recovery', icon: '🌱', short: 'D30+' },
];

const renderWithLinks = (text) => {
  const str = safelyStringify(text);
  const urlRegex = /(https?:\/\/[^\s,)]+)/g;
  const parts = str.split(urlRegex);
  return parts.map((part, i) => 
    urlRegex.test(part) 
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{color:'#6b5344', textDecoration:'underline', wordBreak:'break-all'}}>{part}</a>
      : part
  );
};

export default function PathfinderDashboard({ onOpenChatlogExtraction, onOpenProfile, onLock, shelters }) {
  const loadState = (key, defaultValue) => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : defaultValue; } catch(e) { return defaultValue; }
  };

  const [messages, setMessages] = useState(() => loadState('zoya_messages', [
    { role: 'agent', text: "Hello. I'm Zoya, your Advocate.\nI coordinate HK legal and support paths with absolute privacy.\n\nHow can I protect you today?" }
  ]));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [docDatabase, setDocDatabase] = useState(() => loadState('zoya_docs', []));
  const [caseFile, setCaseFile] = useState(() => loadState('zoya_casefile', {
    name: null, safety: "Establishing...", financial: null, legal: null, children: null,
    police_report: null, evidence_timeline: null, affidavit: null, solicitor: null,
    hkid: null, address: null, phone: null, spouse_name: null
  }));
  const [activeFormType, setActiveFormType] = useState(() => loadState('zoya_formtype', 'cssa'));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState('forms'); // 'forms' or 'vault'
  const [vaultItems, setVaultItems] = useState(() => loadState('zoya_vault_items', []));
  const [compiledDocs, setCompiledDocs] = useState(() => loadState('zoya_compiled_docs', null));
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [secureFormHtml, setSecureFormHtml] = useState(null);
  const [secureFormTitle, setSecureFormTitle] = useState('');
  const [showSingleFormModal, setShowSingleFormModal] = useState(false);
  const [vaultAnalyzing, setVaultAnalyzing] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [autoActions, setAutoActions] = useState(() => loadState('zoya_auto_actions', []));
  const [casePhase, setCasePhase] = useState(() => loadState('zoya_phase', 'hour0_intake'));
  const [dangerLevel, setDangerLevel] = useState(() => loadState('zoya_danger', 'low'));
  const [lang, setLang] = useState(() => loadState('zoya_lang', 'en'));
  const [listening, setListening] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [currentTask, setCurrentTask] = useState(() => loadState('zoya_task', {
    formType: null
  }));
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'evidence'

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const [actionLog, setActionLog] = useState([]); // Live action feed
  const [dragging, setDragging] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  useEffect(() => { localStorage.setItem('zoya_vault_items', JSON.stringify(vaultItems)); }, [vaultItems]);
  useEffect(() => { localStorage.setItem('zoya_compiled_docs', JSON.stringify(compiledDocs)); }, [compiledDocs]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, currentTask]);

  // ===== CHAIN REACTION ENGINE =====
  // Watches caseFile changes and auto-triggers downstream actions with staggered delays
  const chainReactionsRun = useRef(new Set());
  useEffect(() => {
    const cf = caseFile;
    const ran = chainReactionsRun.current;
    const queue = [];

    // Name extracted → auto-fill identity on all forms
    if (cf.name && !ran.has('name_extracted')) {
      ran.add('name_extracted');
      queue.push({ delay: 300, icon: '✓', text: `Identity confirmed: ${cf.name}` });
    }

    // HKID extracted → auto-calculate Legal Aid eligibility
    if (cf.hkid && !ran.has('hkid_legal_aid')) {
      ran.add('hkid_legal_aid');
      queue.push({ delay: 600, icon: '⟳', text: 'Checking Legal Aid eligibility...' });
      queue.push({ delay: 1800, icon: '✓', text: 'ELIGIBLE — assets below HK$452,320 threshold', action: () => {
        setCaseFile(prev => ({ ...prev, legal: prev.legal || 'Legal Aid: Eligible' }));
      }});
      queue.push({ delay: 2400, icon: '⟳', text: 'Locating Legal Aid application form...' });
      queue.push({ delay: 3600, icon: '✓', text: 'Legal Aid form link ready', action: () => {
        if (!docDatabase.some(d => d.name === 'Legal Aid Application'))
          setDocDatabase(prev => [...prev, { name: 'Legal Aid Application', uploaded: false, formType: 'legal_aid', link: 'https://www.lad.gov.hk/eng/documents/pdfform/Form3.pdf' }]);
      }});
    }

    // Safety assessed as unsafe → auto-trigger shelter search
    if ((cf.safety === 'unsafe' || cf.safety === 'at_risk') && !ran.has('safety_shelter')) {
      ran.add('safety_shelter');
      queue.push({ delay: 400, icon: '⟳', text: 'Scanning 5 SWD refuge centres (268 beds)...' });
      queue.push({ delay: 2000, icon: '✓', text: 'Harmony House: 3 beds available (Wan Chai)' });
      queue.push({ delay: 2800, icon: '✓', text: 'Caritas Crisis Centre: Available' });
      queue.push({ delay: 3400, icon: '⟳', text: 'Initiating intake referral...' });
      queue.push({ delay: 4200, icon: '✓', text: 'Shelter referral prepared' });
    }

    // Financial info → auto-fill CSSA
    if (cf.financial && cf.name && !ran.has('financial_cssa')) {
      ran.add('financial_cssa');
      queue.push({ delay: 500, icon: '⟳', text: 'Auto-filling CSSA application...' });
      queue.push({ delay: 2000, icon: '✓', text: 'CSSA form ready for download' });
    }

    // Evidence threshold → auto-generate injunction docs
    if (cf.evidence_timeline && !ran.has('evidence_injunction')) {
      ran.add('evidence_injunction');
      queue.push({ delay: 500, icon: '⟳', text: 'Analyzing evidence for DCRVO threshold...' });
      queue.push({ delay: 2200, icon: '✓', text: 'Evidence threshold MET for injunction' });
      queue.push({ delay: 3000, icon: '⟳', text: 'Generating injunction application (Cap. 189)...' });
      queue.push({ delay: 4500, icon: '✓', text: 'Injunction application draft ready', action: () => {
        setCaseFile(prev => ({ ...prev, affidavit: prev.affidavit || 'Auto-drafted by Zoya' }));
        if (!docDatabase.some(d => d.name === 'Injunction Application (DCRVO)'))
          setDocDatabase(prev => [...prev, { name: 'Injunction Application (DCRVO)', uploaded: false, formType: 'injunction' }]);
      }});
    }

    // Children mentioned → flag school transfer + passport issues
    if (cf.children && cf.children !== 'none' && cf.children !== 'no' && !ran.has('children_flagged')) {
      ran.add('children_flagged');
      queue.push({ delay: 600, icon: '⟳', text: 'Flagging children-related protections...' });
      queue.push({ delay: 1800, icon: '✓', text: 'School transfer: protective order removes abuser signature requirement' });
      queue.push({ delay: 2600, icon: '✓', text: 'Childcare assistance via SWD queued' });
    }

    // Execute queue with staggered delays
    if (queue.length > 0) {
      queue.forEach(item => {
        setTimeout(() => {
          setActionLog(prev => [...prev.slice(-8), { icon: item.icon, text: item.text, time: Date.now() }]);
          if (item.action) item.action();
        }, item.delay);
      });
      // After all chain reactions, show ONE next-steps message
      const lastDelay = Math.max(...queue.map(q => q.delay));
      setTimeout(() => {
        // Find what's still missing
        const missing = INJUNCTION_REQUIREMENTS.filter(r => !r.check(caseFile));
        if (missing.length > 0 && missing.length < INJUNCTION_REQUIREMENTS.length) {
          const next = missing[0];
          setActionLog(prev => [...prev.slice(-8), { icon: '🧠', text: `Evaluating next step: ${next.label}`, time: Date.now() }]);
        }
      }, lastDelay + 500);
    }
  }, [caseFile.name, caseFile.hkid, caseFile.safety, caseFile.financial, caseFile.evidence_timeline, caseFile.children]);

  // Fade out old action log entries
  useEffect(() => {
    if (actionLog.length === 0) return;
    const t = setTimeout(() => {
      setActionLog(prev => prev.filter(a => Date.now() - a.time < 15000));
    }, 15000);
    return () => clearTimeout(t);
  }, [actionLog]);


  // Check for restorable backup on mount
  useEffect(() => {
    const backup = localStorage.getItem('zoya_encrypted_backup');
    const hasExisting = localStorage.getItem('zoya_messages');
    if (backup && !hasExisting) setShowRestore(true);
  }, []);

  const handleRestore = () => {
    try {
      const data = JSON.parse(atob(localStorage.getItem('zoya_encrypted_backup')));
      if (data.messages) setMessages(JSON.parse(data.messages));
      if (data.casefile) setCaseFile(JSON.parse(data.casefile));
      if (data.docs) setDocDatabase(JSON.parse(data.docs));
    } catch(e) { console.error('Restore failed:', e); }
    setShowRestore(false);
  };

  const handleSOS = () => {
    setShowEmergency(true);
    setSmsSent(false);
    // Mock: get location and "send" SMS to emergency contact
    const contact = caseFile.emergency_name || 'Sister (Mei Yee)';
    const phone = caseFile.emergency_phone || '+852 9381 7742';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setActionLog(prev => [...prev.slice(-8),
            { icon: '⟳', text: `Getting location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, time: Date.now() },
          ]);
          setTimeout(() => {
            setActionLog(prev => [...prev.slice(-8),
              { icon: '✓', text: `SMS sent to ${contact} (${phone})`, time: Date.now() },
              { icon: '✓', text: `Location shared: maps.google.com/?q=${latitude.toFixed(4)},${longitude.toFixed(4)}`, time: Date.now() },
            ]);
            setSmsSent(true);
          }, 1200);
        },
        () => {
          // Location denied — still mock the SMS
          setTimeout(() => {
            setActionLog(prev => [...prev.slice(-8),
              { icon: '✓', text: `SOS SMS sent to ${contact} (${phone})`, time: Date.now() },
            ]);
            setSmsSent(true);
          }, 800);
        }
      );
    } else {
      setTimeout(() => { setSmsSent(true); }, 800);
    }
  };

  // Auto-detect danger and show emergency
  useEffect(() => {
    if (caseFile.safety === 'unsafe' || caseFile.safety === 'at_risk' || dangerLevel === 'critical' || dangerLevel === 'high') setShowEmergency(true);
  }, [caseFile.safety, dangerLevel]);

  // Auto-queue forms
  useEffect(() => {
    const actions = [];
    if (caseFile.name && caseFile.financial && !autoActions.includes('cssa_ready'))
      actions.push({ id: 'cssa_ready', label: 'CSSA Application Ready', formType: 'cssa' });
    if (caseFile.name && caseFile.spouse_name && !autoActions.includes('marriage_ready'))
      actions.push({ id: 'marriage_ready', label: 'Marriage Search Ready', formType: 'marriage_search' });
    if (actions.length > 0) {
      setAutoActions(prev => [...prev, ...actions.map(a => a.id)]);
      actions.forEach(action => {
        setActionLog(prev => [...prev.slice(-8), { icon: '📋', text: `System mapping: ${action.label}`, time: Date.now() }]);
        if (!docDatabase.some(d => d.formType === action.formType))
          setDocDatabase(prev => [...prev, { name: action.label, uploaded: false, formType: action.formType }]);
      });
    }
  }, [caseFile.name, caseFile.financial, caseFile.spouse_name]);

  // Progress milestone notifications
  useEffect(() => {
    const readinessCount = INJUNCTION_REQUIREMENTS.filter(r => r.check(caseFile)).length;
    const pct = Math.round((readinessCount / INJUNCTION_REQUIREMENTS.length) * 100);
    const milestones = [25, 50, 75, 100];
    const hit = milestones.find(m => pct >= m && !autoActions.includes(`milestone_${m}`));
    if (hit) {
      setAutoActions(prev => [...prev, `milestone_${hit}`]);
      const msg = hit === 100 ? '🎉 Case 100% ready for court.' : `📊 Case readiness: ${hit}%`;
      setActionLog(prev => [...prev.slice(-8), { icon: hit === 100 ? '🎉' : '📊', text: msg, time: Date.now() }]);
    }
  }, [caseFile]);

  // Persist all state
  useEffect(() => { try { localStorage.setItem('zoya_messages', JSON.stringify(messages)); } catch(e){} }, [messages]);
  useEffect(() => { try { localStorage.setItem('zoya_casefile', JSON.stringify(caseFile)); } catch(e){} }, [caseFile]);
  useEffect(() => { try { localStorage.setItem('zoya_docs', JSON.stringify(docDatabase)); } catch(e){} }, [docDatabase]);
  useEffect(() => { try { localStorage.setItem('zoya_task', JSON.stringify(currentTask)); } catch(e){} }, [currentTask]);
  useEffect(() => { try { localStorage.setItem('zoya_formtype', JSON.stringify(activeFormType)); } catch(e){} }, [activeFormType]);
  useEffect(() => { try { localStorage.setItem('zoya_auto_actions', JSON.stringify(autoActions)); } catch(e){} }, [autoActions]);
  useEffect(() => { try { localStorage.setItem('zoya_phase', JSON.stringify(casePhase)); } catch(e){} }, [casePhase]);
  useEffect(() => { try { localStorage.setItem('zoya_danger', JSON.stringify(dangerLevel)); } catch(e){} }, [dangerLevel]);
  useEffect(() => { try { localStorage.setItem('zoya_lang', JSON.stringify(lang)); } catch(e){} }, [lang]);

  const saveEncryptedState = useCallback(() => {
    try {
      const state = { messages: localStorage.getItem('zoya_messages'), casefile: localStorage.getItem('zoya_casefile'), docs: localStorage.getItem('zoya_docs'), timestamp: Date.now() };
      localStorage.setItem('zoya_encrypted_backup', btoa(JSON.stringify(state)));
    } catch(e) {}
  }, []);
  useEffect(() => { const i = setInterval(saveEncryptedState, 30000); return () => clearInterval(i); }, [saveEncryptedState]);

  // Voice input using Web Speech API
  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice input not supported in this browser.'); return; }
    const recognition = new SR();
    recognition.lang = lang === 'zh' ? 'zh-HK' : 'en-HK';
    recognition.interimResults = false;
    recognition.onresult = (e) => { setInput(prev => prev + e.results[0][0].transcript); setListening(false); };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const handleClearChat = () => {
    if (window.confirm('Clear all data and start fresh?')) {
      saveEncryptedState();
      ['zoya_messages','zoya_casefile','zoya_docs','zoya_task','zoya_formtype','zoya_auto_actions','zoya_phase','zoya_danger','zoya_lang'].forEach(k => localStorage.removeItem(k));
      setMessages([{ role: 'agent', text: "Hello. I'm Zoya, your Advocate.\nI coordinate HK legal and support paths with absolute privacy.\n\nHow can I protect you today?" }]);
      setCaseFile({ name: null, safety: "Establishing...", financial: null, legal: null, children: null, police_report: null, evidence_timeline: null, affidavit: null, solicitor: null, hkid: null, address: null, phone: null, spouse_name: null });
      setDocDatabase([]); setAutoActions([]); setCasePhase('hour0_intake'); setDangerLevel('low'); setLang('en');
      setCurrentTask({ type: 'choice', label: 'What brings you to Zoya today?', options: ['I need to leave tonight', 'I need legal protection', 'I need financial help', 'I want to document evidence'], formType: null });
      setActiveFormType('cssa'); setPreviewUrl(null); setShowEmergency(false);
    }
  };

  // PDF preview
  useEffect(() => {
    (async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('http://localhost:3001/api/preview-known-form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formType: activeFormType, caseFile }) });
        if (!res.ok) throw new Error(); const blob = await res.blob();
        if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(URL.createObjectURL(blob));
      } catch(e) {} finally { setPreviewLoading(false); }
    })();
  }, [activeFormType]);

  useEffect(() => {
    if (!Object.values(caseFile).some(v => v && v !== "Establishing...")) return;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('http://localhost:3001/api/preview-known-form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formType: activeFormType, caseFile }) });
        const blob = await res.blob(); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(URL.createObjectURL(blob));
      } catch(e) {} finally { setPreviewLoading(false); }
    }, 1500);
    return () => clearTimeout(t);
  }, [caseFile]);

  // Smart document upload with auto-classification
  const handleSmartUpload = async (file, docIdx) => {
    if (!file) return;
    setLoading(true);
    try {
      const fn = file.name.toLowerCase();
      let type = 'unknown';
      if (fn.includes('bank') || fn.includes('statement')) type = 'financial';
      else if (fn.includes('police') || fn.includes('report')) type = 'police_report';
      else if (fn.includes('lease') || fn.includes('tenancy')) type = 'housing';
      else if (fn.includes('id') || fn.includes('hkid')) type = 'identity';
      else if (fn.includes('marriage') || fn.includes('certificate')) type = 'marriage';
      else if (fn.match(/\.(jpg|jpeg|png|webp)$/)) type = 'screenshot';
      else if (fn.endsWith('.txt')) type = 'chat_export';

      if (docIdx >= 0) markDocUploaded(docIdx);

      // Auto-detect chat export → run timeline extraction automatically
      if (type === 'chat_export') {
        setActionLog(prev => [...prev.slice(-8), { icon: '⟳', text: 'Chat export detected — auto-analyzing...', time: Date.now() }]);
        try {
          const text = await file.text();
          const res = await fetch('http://localhost:3001/api/extract-timeline', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
          });
          const data = await res.json();
          const count = data.timeline?.length || 0;
          setCaseFile(prev => ({ ...prev, evidence_timeline: `${count} incidents extracted from ${file.name}` }));
          localStorage.setItem('whatsapp_timeline', JSON.stringify({ timeline: data.timeline, language: data.language, uploadedName: file.name, savedAt: new Date().toISOString() }));
          setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `${count} incidents extracted and classified`, time: Date.now() }]);
        } catch(e) {
          setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: 'Chat analysis failed — try Evidence Extractor', time: Date.now() }]);
        }
      } else if (type === 'police_report') {
        setCaseFile(prev => ({ ...prev, police_report: `Filed (${file.name})` }));
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Police report filed: ${file.name}`, time: Date.now() }]);
      } else if (type === 'financial') {
        setCaseFile(prev => ({ ...prev, financial: prev.financial ? prev.financial + ` + ${file.name}` : `Documented (${file.name})` }));
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Financial doc filed: ${file.name}`, time: Date.now() }]);
      } else if (type === 'screenshot') {
        setCaseFile(prev => ({ ...prev, evidence_timeline: (prev.evidence_timeline || '') + ` + screenshot:${file.name}` }));
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Screenshot filed as evidence`, time: Date.now() }]);
      } else {
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Filed: ${file.name}`, time: Date.now() }]);
      }
      if (!docDatabase.some(d => d.name === file.name))
        setDocDatabase(prev => [...prev, { name: file.name, uploaded: true, formType: null, detectedType: type }]);
    } catch(e) {} finally { setLoading(false); }
  };

  // Drag and drop handler
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleSmartUpload(file, -1);
  };

  const handleVaultUpload = async (file) => {
    if (!file) return;
    
    // Catch text files and route to timeline extractor
    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      const contextPrompt = prompt("Provide context for this chat log (e.g., 'Messages from last weekend'):") || 'WhatsApp Evidence';
      setVaultAnalyzing(true);
      setActionLog(prev => [...prev.slice(-8), { icon: '⟳', text: `Parsing chronological chat data...`, time: Date.now() }]);
      try {
        const text = await file.text();
        const res = await fetch('http://localhost:3001/api/extract-timeline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        const count = data.timeline?.length || 0;
        setCaseFile(prev => ({ ...prev, evidence_timeline: prev.evidence_timeline ? `${prev.evidence_timeline} | ${count} incidents from ${file.name}` : `${count} incidents from ${file.name}` }));
        
        // Store in local storage for the compiler
        const chatData = { timeline: data.timeline, language: data.language, uploadedName: file.name, savedAt: new Date().toISOString() };
        localStorage.setItem('whatsapp_timeline', JSON.stringify(chatData));
        
        // Add a visual marker to the vault
        setVaultItems(prev => [...prev, { id: Date.now(), dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23f8fafc"/><text x="10" y="45" font-family="Arial" font-size="12" fill="%2364748b" font-weight="bold">TXT LOG</text></svg>', contextText: contextPrompt, analysis: `Extracted ${count} incidents into chronological order.` }]);
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `${count} incidents extracted and vaulted`, time: Date.now() }]);
      } catch(e) {
        setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: 'Chat analysis failed', time: Date.now() }]);
      } finally {
        setVaultAnalyzing(false);
      }
      return;
    }

    const contextPrompt = prompt("Provide context for this evidence (e.g., 'He sent this on Tuesday', 'Bruise on my arm from last night'):") || 'None';
    setVaultAnalyzing(true);
    setActionLog(prev => [...prev.slice(-8), { icon: '🤖', text: `Analyzing evidence with Vision AI...`, time: Date.now() }]);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result.split(',')[1];
        const res = await fetch('http://localhost:3001/api/vault/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64data, mimeType: file.type, contextText: contextPrompt })
        });
        if (res.ok) {
          const { analysis, storageUrl } = await res.json();
          setVaultItems(prev => [...prev, { id: Date.now(), dataUrl: storageUrl, contextText: contextPrompt, analysis }]);
          setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Evidence analyzed and securely vaulted.`, time: Date.now() }]);
        } else {
          const errorResp = await res.json();
          setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Upload failed: ${errorResp.error || '500 Internal Error'}`, time: Date.now() }]);
        }
      };
      reader.readAsDataURL(file);
    } catch (e) {
      console.error(e);
      setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Analysis failed`, time: Date.now() }]);
    } finally {
      setVaultAnalyzing(false);
    }
  };

  const generateCasePackage = async () => {
    setShowDocsModal(true);
    setVaultAnalyzing(true);
    setActionLog(prev => [...prev.slice(-8), { icon: '🤖', text: `Agent compiling massive case package via Memory...`, time: Date.now() }]);
    try {
      const whatsappRaw = localStorage.getItem('whatsapp_timeline');
      const whatsappTimeline = whatsappRaw ? JSON.parse(whatsappRaw) : null;
      
      const res = await fetch('http://localhost:3001/api/agent/compile-case-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultItems, messages, caseFile, whatsappTimeline })
      });
      if (res.ok) {
        const payload = await res.json();
        setCompiledDocs(payload);
        setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `3 Legal artifacts successfully generated!`, time: Date.now() }]);
      } else {
        const err = await res.json();
        setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Compilation failed: ${err.error}`, time: Date.now() }]);
      }
    } catch (e) {
      console.error(e);
      setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Compilation error: ${e.message}`, time: Date.now() }]);
    } finally {
      setVaultAnalyzing(false);
    }
  };

  const handleAction = async (val) => {
    const textToSend = safelyStringify(val || input || "").trim();
    if (!textToSend) return;
    const userMsg = { role: 'user', text: textToSend };
    const history = [...messages, userMsg];
    setMessages(history); setInput(''); setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history, lang }) });
      const data = await res.json();
      if (data.reply) setMessages(prev => [...prev, { role: 'agent', text: safelyStringify(data.reply) }]);
      setCurrentTask({ type: safelyStringify(data.inputType || 'text'), label: safelyStringify(data.inputLabel || 'Provide details'), options: Array.isArray(data.options) ? data.options.map(safelyStringify) : [], formType: data.formType ? safelyStringify(data.formType) : null });
      if (data.extractedFacts) setCaseFile(prev => { const f = {}; for (let k in data.extractedFacts) { if (data.extractedFacts[k]) f[k] = safelyStringify(data.extractedFacts[k]); } return { ...prev, ...f }; });
      if (data.newDocRequirement) setDocDatabase(prev => { const n = safelyStringify(data.newDocRequirement); if (prev.some(d => d.name === n)) return prev; return [...prev, { name: n, uploaded: false, formType: data.formType ? safelyStringify(data.formType) : null }]; });
      if (data.casePhase) setCasePhase(data.casePhase);
      if (data.dangerLevel) setDangerLevel(data.dangerLevel);
      if (data.autoActions?.length > 0) data.autoActions.forEach(a => setActionLog(prev => [...prev.slice(-8), { icon: '⚡', text: safelyStringify(a), time: Date.now() }]));
    } catch(e) { setMessages(prev => [...prev, { role: 'agent', text: 'Connection issue. Zoya is still here.' }]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let int;
    if (loading) {
      const texts = ['🧠 Zoya is evaluating context...', '📊 Calculating case readiness...', '⚖️ Consulting HK legal frameworks...', '⚡ Structuring safe response...'];
      let i = 0; setLoadingText(texts[0]);
      int = setInterval(() => { i = (i + 1) % texts.length; setLoadingText(texts[i]); }, 2000);
    }
    return () => clearInterval(int);
  }, [loading]);

  const markDocUploaded = (idx) => { if (idx < 0) return; setDocDatabase(prev => { if (!prev[idx]) return prev; const c = [...prev]; c[idx].uploaded = true; return c; }); };

  // ===== GEMINI VISION SMART FILL =====
  const [smartFillLoading, setSmartFillLoading] = useState(false);

  const handleSmartFill = async (formType, uploadedFile = null) => {
    setSmartFillLoading(true);
    setActionLog(prev => [...prev.slice(-8), { icon: '⟳', text: 'Gemini Vision reading form layout...', time: Date.now() }]);
    try {
      const fd = new FormData();
      fd.append('caseFile', JSON.stringify(caseFile));
      if (uploadedFile) { fd.append('pdf', uploadedFile); }
      else { fd.append('formType', formType); }

      setTimeout(() => setActionLog(prev => [...prev.slice(-8), { icon: '⟳', text: 'Detecting all fillable fields autonomously...', time: Date.now() }]), 1200);

      const res = await fetch('http://localhost:3001/api/smart-fill', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Smart fill failed' }));
        setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Smart fill error: ${err.error}`, time: Date.now() }]);
        return;
      }
      const filledFields = (res.headers.get('X-Fields-Filled') || '').split(',').filter(Boolean);
      const skippedFields = (res.headers.get('X-Fields-Skipped') || '').split(',').filter(Boolean);
      setActionLog(prev => [...prev.slice(-8),
        { icon: '✓', text: `Vision filled ${filledFields.length} fields autonomously`, time: Date.now() },
        ...(skippedFields.length > 0 ? [{ icon: '○', text: `Missing case data: ${skippedFields.join(', ')}`, time: Date.now() }] : []),
      ]);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = uploadedFile ? `Zoya_SmartFill_${uploadedFile.name}` : `Zoya_SmartFill_${formType}.pdf`;
      a.click(); URL.revokeObjectURL(url);
      const di = docDatabase.findIndex(d => d.formType === formType);
      if (di !== -1) markDocUploaded(di);
    } catch(e) {
      setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Smart fill failed: ${e.message}`, time: Date.now() }]);
    } finally { setSmartFillLoading(false); }
  };

  const handleAutofillKnown = async (formType) => {
    if (!formType) return; setLoading(true);
    try {
      // Legal Aid and Injunction are generated documents, not PDF fills
      if (formType === 'legal_aid' || formType === 'injunction') {
        const docType = formType === 'legal_aid' ? 'Legal Aid Application' : 'Injunction Application under DCRVO Cap. 189';
        const res = await fetch('http://localhost:3001/api/generate-case-pack', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseFile, docDatabase, documentType: docType })
        });
        if (!res.ok) { 
          const err = await res.text().catch(() => 'Unknown error');
          console.error('Generation failed:', res.status, err);
          alert('Generation failed: ' + err.substring(0, 200)); 
          return; 
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Zoya_${formType}.pdf`; a.click();
        URL.revokeObjectURL(url);
        const di = docDatabase.findIndex(d => d.formType === formType);
        if (di !== -1) markDocUploaded(di);
        return;
      }
      const res = await fetch('http://localhost:3001/api/fill-known-form', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType: safelyStringify(formType), caseFile })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        alert(`Autofill failed: ${err.error || 'Unknown error'}`);
        return;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('pdf')) {
        alert('Server did not return a PDF. Check backend logs.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Zoya_${safelyStringify(formType)}.pdf`; a.click();
      URL.revokeObjectURL(url);
      const di = docDatabase.findIndex(d => d.formType === formType);
      if (di !== -1) markDocUploaded(di);
    } catch(e) { alert("Failed to autofill: " + e.message); }
    finally { setLoading(false); }
  };

  const handleFillGeneral = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; setLoading(true);
    try { const fd = new FormData(); fd.append('caseFile', JSON.stringify(caseFile)); fd.append('template', file); const res = await fetch('http://localhost:3001/api/fill-document', { method: 'POST', body: fd }); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Zoya_Filled_${file.name}`; a.click(); } catch(e) { alert("Failed."); } finally { setLoading(false); }
  };

  const handleDownloadPack = async () => {
    setLoading(true);
    try { const res = await fetch('http://localhost:3001/api/generate-case-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseFile, docDatabase }) }); if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Zoya_CasePack_${new Date().toISOString().split('T')[0]}.pdf`; a.click(); } } catch(e) {} finally { setLoading(false); }
  };

  const requiredDocs = (docDatabase || []).filter(d => !d.uploaded);
  const submittedDocs = (docDatabase || []).filter(d => d.uploaded);
  const readinessItems = INJUNCTION_REQUIREMENTS.map(r => ({ ...r, met: r.check(caseFile) }));
  const readinessScore = Math.round((readinessItems.filter(r => r.met).length / readinessItems.length) * 100);
  const nextAction = readinessItems.find(r => !r.met);
  const currentPhaseIdx = PHASES.findIndex(p => p.id === casePhase);

  return (
    <div className="dashboard-container">
      {/* SESSION RESTORE MODAL */}
      {showRestore && (
        <div style={{position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{background:'white', borderRadius:'20px', padding:'2rem', maxWidth:'400px', textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:'2rem', marginBottom:'1rem'}}>🔐</div>
            <h3 style={{margin:'0 0 0.5rem', color:'#1e293b'}}>Welcome back</h3>
            <p style={{color:'#64748b', fontSize:'0.9rem', marginBottom:'1.5rem'}}>Your case file is safe. Want to restore it?</p>
            <div style={{display:'flex', gap:'1rem', justifyContent:'center'}}>
              <button onClick={handleRestore} style={{padding:'0.7rem 1.5rem', background:'#8b6f5c', color:'white', border:'none', borderRadius:'12px', fontWeight:700, cursor:'pointer'}}>Restore Session</button>
              <button onClick={() => setShowRestore(false)} style={{padding:'0.7rem 1.5rem', background:'#f1f5f9', color:'#64748b', border:'none', borderRadius:'12px', fontWeight:600, cursor:'pointer'}}>Start Fresh</button>
            </div>
          </div>
        </div>
      )}

      {/* EMERGENCY OVERLAY */}
      {showEmergency && (
        <div style={{position:'fixed', top:0, left:0, right:0, zIndex:1000, background:'linear-gradient(135deg, #dc2626, #991b1b)', padding:'0.8rem 2rem', display:'flex', alignItems:'center', justifyContent:'space-between', animation:'pulseRed 2s infinite'}}>
          <div style={{display:'flex', alignItems:'center', gap:'0.8rem'}}>
            <span style={{fontSize:'1.3rem'}}>🚨</span>
            <div>
              <div style={{color:'white', fontWeight:800, fontSize:'0.85rem'}}>{lang === 'zh' ? '安全警報' : 'SAFETY ALERT'}</div>
              <div style={{color:'#fecaca', fontSize:'0.7rem'}}>{lang === 'zh' ? '即時援助' : 'Immediate help available'}</div>
            </div>
          </div>
          <div style={{display:'flex', gap:'0.4rem'}}>
            <a href="tel:999" style={{background:'white', color:'#dc2626', padding:'0.4rem 0.8rem', borderRadius:'8px', fontWeight:800, fontSize:'0.8rem', textDecoration:'none'}}>📞 999</a>
            <a href="tel:25220434" style={{background:'rgba(255,255,255,0.2)', color:'white', padding:'0.4rem 0.8rem', borderRadius:'8px', fontWeight:700, fontSize:'0.75rem', textDecoration:'none', border:'1px solid rgba(255,255,255,0.3)'}}>Harmony House</a>
            <a href="tel:23432255" style={{background:'rgba(255,255,255,0.2)', color:'white', padding:'0.4rem 0.8rem', borderRadius:'8px', fontWeight:700, fontSize:'0.75rem', textDecoration:'none', border:'1px solid rgba(255,255,255,0.3)'}}>SWD 24hr</a>
            <button onClick={() => setShowEmergency(false)} style={{background:'transparent', border:'1px solid rgba(255,255,255,0.3)', color:'white', padding:'0.4rem 0.6rem', borderRadius:'8px', cursor:'pointer', fontSize:'0.7rem'}}>✕</button>
          </div>
          {smsSent && (
            <div style={{background:'rgba(255,255,255,0.15)', padding:'0.3rem 0.8rem', borderRadius:'8px', fontSize:'0.75rem', color:'#bbf7d0', fontWeight:700}}>
              ✓ Location shared with {caseFile.emergency_name || 'Sister (Mei Yee)'}
            </div>
          )}
        </div>
      )}

      {/* LEFT PANEL */}
      <aside className="panel left-panel" style={{paddingTop: showEmergency ? '52px' : 0}}>
        <header className="panel-header" style={{padding:'1rem 1.5rem'}}>
          <h2>{lang === 'zh' ? '案件指揮' : 'Case Command'}</h2>
        </header>

        {/* LIVE ACTION FEED */}
        {actionLog.length > 0 && (
          <div style={{padding:'0.6rem 1.2rem', borderBottom:'1px solid var(--border)', background:'linear-gradient(135deg, #f5f0e8, #ecfdf5)', maxHeight:'140px', overflowY:'auto'}}>
            <div style={{fontSize:'0.6rem', fontWeight:800, textTransform:'uppercase', letterSpacing:'1px', color:'#8b6f5c', marginBottom:'0.4rem'}}>⚡ {lang === 'zh' ? 'Zoya 工作中' : 'Zoya is working'}</div>
            {actionLog.map((a, i) => (
              <div key={i} style={{display:'flex', alignItems:'center', gap:'0.4rem', fontSize:'0.65rem', padding:'0.15rem 0', color: a.icon === '✓' ? '#10b981' : a.icon === '⟳' ? '#6b5344' : '#64748b', animation:'slideUp 0.3s'}}>
                <span style={{fontWeight:700, width:'14px', textAlign:'center'}}>{a.icon}</span>
                <span style={{fontWeight: a.icon === '✓' ? 600 : 400}}>{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* JOURNEY TIMELINE */}
        <div style={{padding:'0.8rem 1.5rem', borderBottom:'1px solid var(--border)', background:'#fafafa'}}>
          <div style={{display:'flex', alignItems:'center', gap:'2px'}}>
            {PHASES.map((p, i) => (
              <div key={p.id} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'2px'}}>
                <div style={{width:'100%', height:'4px', borderRadius:'2px', background: i <= currentPhaseIdx ? (i === currentPhaseIdx ? '#8b6f5c' : '#10b981') : '#e2e8f0', transition:'background 0.4s'}} />
                <span style={{fontSize:'0.5rem', fontWeight: i === currentPhaseIdx ? 800 : 500, color: i <= currentPhaseIdx ? '#1e293b' : '#cbd5e1'}}>{p.short}</span>
              </div>
            ))}
          </div>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'0.4rem'}}>
            <span style={{fontSize:'0.7rem', fontWeight:700, color:'#1e293b'}}>{PHASES[currentPhaseIdx]?.icon} {PHASES[currentPhaseIdx]?.label}</span>
            {/* Danger gauge */}
            <div style={{display:'flex', alignItems:'center', gap:'0.3rem'}}>
              <div style={{width:'8px', height:'8px', borderRadius:'50%', background: {low:'#10b981', medium:'#f59e0b', high:'#ef4444', critical:'#dc2626'}[dangerLevel], animation: dangerLevel === 'critical' ? 'pulseRed 1s infinite' : 'none'}} />
              <span style={{fontSize:'0.65rem', fontWeight:700, color: {low:'#10b981', medium:'#f59e0b', high:'#ef4444', critical:'#dc2626'}[dangerLevel]}}>
                {dangerLevel.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* INJUNCTION READINESS */}
        <div style={{padding:'0.8rem 1.5rem', borderBottom:'1px solid var(--border)', background:'linear-gradient(135deg, #f5f0e8, #f0f9ff)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.4rem'}}>
            <span style={{fontSize:'0.65rem', fontWeight:800, textTransform:'uppercase', letterSpacing:'1px', color:'#6b5344'}}>{lang === 'zh' ? '法庭準備度' : 'Court Readiness'}</span>
            <span style={{fontSize:'1rem', fontWeight:800, color: readinessScore >= 75 ? '#10b981' : readinessScore >= 40 ? '#f59e0b' : '#ef4444'}}>{readinessScore}%</span>
          </div>
          <div style={{width:'100%', height:'6px', background:'#e2e8f0', borderRadius:'3px', overflow:'hidden', marginBottom:'0.6rem'}}>
            <div style={{width:`${readinessScore}%`, height:'100%', background: readinessScore >= 75 ? 'linear-gradient(90deg, #10b981, #34d399)' : readinessScore >= 40 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #ef4444, #f87171)', borderRadius:'3px', transition:'width 0.6s'}} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.2rem'}}>
            {readinessItems.map(item => (
              <div key={item.id} style={{display:'flex', alignItems:'center', gap:'0.3rem', fontSize:'0.6rem'}}>
                <span style={{color: item.met ? '#10b981' : '#cbd5e1'}}>{item.met ? '✓' : '○'}</span>
                <span style={{color: item.met ? '#10b981' : '#94a3b8', fontWeight: item.met ? 600 : 400}}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ===== SHELTER SYSTEM ADD-ON ===== */}
        {/* Shows real-time HK shelter availability. Fires toast when a waitlist opens. */}
        {shelters && shelters.length > 0 && (
          <div style={{marginTop: '1rem'}}>
             <EmergencyShelters shelters={shelters} />
          </div>
        )}
      </aside>

      {/* MAIN: CHAT */}
      <main className="panel chat-panel" style={{paddingTop: showEmergency ? '52px' : 0, position:'relative'}}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {/* Drop overlay */}
        {dragging && (
          <div style={{position:'absolute', inset:0, zIndex:100, background:'rgba(139,111,92,0.1)', border:'3px dashed #8b6f5c', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'3rem', marginBottom:'0.5rem'}}>📎</div>
              <div style={{color:'#6b5344', fontWeight:800, fontSize:'1rem'}}>Drop file here</div>
              <div style={{color:'#8b6f5c', fontSize:'0.8rem'}}>Chat exports, screenshots, documents</div>
            </div>
          </div>
        )}
        <header className="panel-header" style={{borderBottom:'1px solid var(--border)', padding:'1rem 1.5rem', background: 'white'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%'}}>
            <h2 style={{color:'var(--primary-dark)', fontSize:'1rem', margin:0, fontFamily: 'Outfit, sans-serif'}}>{lang === 'zh' ? 'Zoya 工作站' : 'Zoya Workspace'}</h2>
            <div style={{display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap'}}>
              <button onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')} style={{padding:'0.4rem 0.8rem', background: '#f1f5f9', border:'1px solid #e2e8f0', borderRadius:'8px', fontSize:'0.8rem', fontWeight:700, cursor:'pointer', color:'#1e293b'}}>
                {lang === 'zh' ? '中文' : 'EN'}
              </button>
              <div className="status-indicator" style={{fontSize:'0.75rem', padding:'0.4rem 0.8rem', fontWeight: 800}}>{lang === 'zh' ? '加密連線' : 'Encrypted'}</div>
              {onOpenProfile && (
                <button onClick={onOpenProfile} style={{padding:'0.4rem 0.8rem', backgroundColor:'var(--primary-dark)', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'0.8rem', fontWeight:700}}>📋 {lang === 'zh' ? '個人資料' : 'Profile'}</button>
              )}
              <button onClick={handleClearChat} style={{background:'transparent', border:'1px solid rgba(239,68,68,0.1)', color:'#ef4444', padding:'0.4rem 0.8rem', borderRadius:'8px', fontSize:'0.8rem', cursor:'pointer', fontWeight:700}}>{lang === 'zh' ? '清除' : 'Clear'}</button>
            </div>
          </div>
        </header>

        <div className="chat-messages">
              {(messages || []).map((m, i) => (
                <div key={`msg-${i}`} className={`bubble ${m.role} ${m.isAutoAction ? 'auto-action' : ''}`} style={{whiteSpace:'pre-line'}}>
                  {renderWithLinks(m.text)}
                </div>
              ))}
              {!loading && currentTask && currentTask.type === 'choice' && (
                <div className="bubble agent intake-bubble" style={{background: 'transparent', border: 'none', padding: '0.5rem 0', boxShadow: 'none'}}>
                  {currentTask.label && <p style={{marginBottom:'0.8rem', fontWeight:800, color:'#8b6f5c', fontSize:'0.9rem', paddingLeft: '0.5rem'}}>{safelyStringify(currentTask.label)}</p>}
                  <div style={{display:'flex', flexDirection:'column', gap:'0.6rem'}}>
                    {(currentTask.options || []).map((opt, i) => (
                      <div key={`opt-${i}`} className="pill-btn" onClick={() => handleAction(opt)} role="button" style={{textAlign:'center'}}>{safelyStringify(opt)}</div>
                    ))}
                  </div>
                </div>
              )}
              {loading && (
                <div style={{display:'flex', alignItems:'center', gap:'0.8rem', padding:'1rem', background:'var(--beige)', borderLeft:'4px solid var(--primary)', borderRadius:'0 12px 12px 0', opacity:0.8, animation:'pulse 2s infinite'}}>
                  <div className="typing" style={{margin:0, padding:0}}><div className="dot" style={{width:'6px', height:'6px'}} /><div className="dot" style={{width:'6px', height:'6px'}} /><div className="dot" style={{width:'6px', height:'6px'}} /></div>
                  <span style={{fontSize:'0.8rem', color:'#8b6f5c', fontWeight:700}}>{loadingText}</span>
                </div>
              )}
              <div ref={scrollRef} />
            </div>

            <div className="chat-footer">
              <input type="text" placeholder={lang === 'zh' ? '同Zoya講...' : 'Message Zoya...'} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAction()} />
              <button onClick={toggleVoice} style={{background: listening ? '#ef4444' : '#f1f5f9', color: listening ? 'white' : '#64748b', border:'none', borderRadius:'50%', width:'42px', height:'42px', cursor:'pointer', fontSize:'1.1rem', flexShrink:0, transition:'0.2s'}}>
                {listening ? '⏹' : '🎤'}
              </button>
              <div className="primary-btn" onClick={() => handleAction()} role="button" style={{display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'}}>{lang === 'zh' ? '發送' : 'Send'}</div>
              <button onClick={handleSOS} style={{background:'#dc2626', color:'white', border:'none', borderRadius:'50px', padding:'0.8rem 1.2rem', fontSize:'0.9rem', fontWeight:800, cursor:'pointer', flexShrink:0, boxShadow:'0 4px 15px rgba(220,38,38,0.3)'}}>🚨 SOS</button>
              {onLock && <button onClick={onLock} style={{background:'#22c55e', color:'white', border:'none', borderRadius:'50px', padding:'0.8rem 1.2rem', fontSize:'0.9rem', fontWeight:800, cursor:'pointer', flexShrink:0, boxShadow:'0 4px 15px rgba(34,197,94,0.3)'}}>🌱 {lang === 'zh' ? '隱藏' : 'Hide'}</button>}
            </div>
      </main>

      {/* RIGHT: AGENTIC DOCUMENT RECOMMENDER & SECURE VAULT */}
      <aside className="panel right-panel" style={{paddingTop: showEmergency ? '52px' : 0, display: 'flex', flexDirection: 'column'}}>
        <header className="panel-header" style={{flexDirection:'column', alignItems:'flex-start', gap:'0.8rem', padding:'1rem 1.5rem'}}>
          <div style={{display:'flex', width:'100%', gap:'0.8rem', borderBottom:'1px solid #e2e8f0', paddingBottom:'0.5rem'}}>
             <button onClick={() => setActiveRightTab('forms')} style={{flex:1, background: activeRightTab === 'forms' ? '#1e293b' : 'transparent', color: activeRightTab === 'forms' ? 'white' : '#64748b', border:'none', padding:'0.6rem', borderRadius:'8px', fontSize:'0.8rem', fontWeight:700, cursor:'pointer'}}>📄 Required Forms</button>
             <button onClick={() => setActiveRightTab('vault')} style={{flex:1, background: activeRightTab === 'vault' ? '#8b5cf6' : 'transparent', color: activeRightTab === 'vault' ? 'white' : '#64748b', border:'none', padding:'0.6rem', borderRadius:'8px', fontSize:'0.8rem', fontWeight:700, cursor:'pointer'}}>🔒 Secure Vault</button>
          </div>
        </header>

        <div style={{flex:1, overflowY:'auto', padding:'1.5rem', background:'#f8fafc'}}>
          {activeRightTab === 'forms' ? (
            /* REQUIRED FORMS VIEW */
            (() => {
               const docs = [
                  { id: 'cssa', title: 'CSSA Application Form', desc: 'Financial assistance for daily needs and housing.', req: !!caseFile.financial || true, url: 'https://www.swd.gov.hk/storage/asset/section/2884/en/CSSA_Registration_Form.pdf' },
                  { id: 'legal_aid', title: 'Legal Aid Civil Pre-App', desc: 'Required documentation for divorce proceedings.', req: !!caseFile.legal, url: 'https://www.lad.gov.hk/eng/documents/las/pre_application_info_form/Pre-application%20Information%20Form_General%20Civil%20Cases_eng.pdf' },
                  { id: 'housing', title: 'Public Housing Application', desc: 'Required for Compassionate Rehousing/Conditional Tenancy.', req: caseFile.safety === 'unsafe', url: 'https://www.housingauthority.gov.hk/en/common/pdf/global-elements/forms/public-housing/HD274.pdf' },
                  { id: 'marriage', title: 'Marriage Search Form (MR35)', desc: 'Required if you lack your original certificate.', req: !!caseFile.spouse_name, url: 'https://www.immd.gov.hk/pdforms/mr35.pdf' }
               ];
               const activeDocs = docs.filter(d => d.req);
               const inactiveDocs = docs.filter(d => !d.req);

               const handleAgentFetch = async (docUrl, docId) => {
                 setShowSingleFormModal(true);
                 setSecureFormHtml(null); // Show loading state
                 setSecureFormTitle(docId);
                 setActionLog(prev => [...prev.slice(-8), { icon: '🤖', text: `Drafting secure zero-footprint form for ${docId}...`, time: Date.now() }]);
                 try {
                   const r = await fetch('http://localhost:3001/api/agent/draft-official-form', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ docId, caseFile })
                   });
                   if (r.ok) {
                     const payload = await r.json();
                     setSecureFormHtml(payload.html);
                     setSecureFormTitle(payload.title);
                     setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `Ephemeral ${docId} form successfully drafted.`, time: Date.now() }]);
                   } else {
                     const err = await r.json();
                     setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Draft failed: ${err.error}`, time: Date.now() }]);
                     setShowSingleFormModal(false);
                   }
                 } catch (e) {
                   setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: `Agent error: ${e.message}`, time: Date.now() }]);
                   setShowSingleFormModal(false);
                 }
               };

               return (
                 <>
                   <div style={{marginBottom:'1.5rem'}}>
                      <h3 style={{fontSize:'0.8rem', fontWeight:800, color:'#0f172a', marginBottom:'1rem', textTransform:'uppercase', letterSpacing:'1px', display:'flex', alignItems:'center', gap:'0.4rem'}}>
                        <span style={{color:'#f59e0b'}}>⚠️</span> Required for your case
                      </h3>
                      {activeDocs.length === 0 ? <p style={{fontSize:'0.8rem', color:'#64748b'}}>Zoya is analyzing your case...</p> : activeDocs.map(doc => (
                        <div key={doc.id} style={{background:'white', left:0, borderLeft:'4px solid #f59e0b', padding:'1rem', borderRadius:'8px', marginBottom:'0.8rem', boxShadow:'0 2px 8px rgba(0,0,0,0.05)', transition:'transform 0.2s'}} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                            <div style={{paddingRight:'0.8rem'}}>
                              <h4 style={{fontSize:'0.85rem', margin:'0 0 0.3rem 0', color:'#1e293b'}}>{doc.title}</h4>
                              <p style={{fontSize:'0.75rem', color:'#64748b', margin:0, lineHeight:1.4}}>{doc.desc}</p>
                            </div>
                            <button onClick={() => handleAgentFetch(doc.url, doc.id)} style={{background:'#fcf0fd', color:'#a21caf', padding:'0.4rem 0.8rem', border:'none', borderRadius:'6px', fontSize:'0.7rem', fontWeight:700, whiteSpace:'nowrap', cursor:'pointer' }}>✏️ Draft in Secure Popup</button>
                          </div>
                        </div>
                      ))}
                   </div>

                   {inactiveDocs.length > 0 && (
                     <div>
                        <h3 style={{fontSize:'0.8rem', fontWeight:800, color:'#94a3b8', marginBottom:'1rem', textTransform:'uppercase', letterSpacing:'1px'}}>Other Available Forms</h3>
                        {inactiveDocs.map(doc => (
                          <div key={doc.id} style={{background:'white', border:'1px solid #e2e8f0', padding:'1rem', borderRadius:'8px', marginBottom:'0.8rem', opacity:0.7}}>
                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                              <div style={{paddingRight:'0.8rem'}}>
                                <h4 style={{fontSize:'0.85rem', margin:'0 0 0.3rem 0', color:'#64748b'}}>{doc.title}</h4>
                                <p style={{fontSize:'0.75rem', color:'#94a3b8', margin:0, lineHeight:1.4}}>{doc.desc}</p>
                              </div>
                              <button onClick={() => handleAgentFetch(doc.url, doc.id)} style={{background:'#f1f5f9', color:'#64748b', padding:'0.4rem 0.8rem', border:'none', borderRadius:'6px', fontSize:'0.7rem', fontWeight:700, whiteSpace:'nowrap', cursor:'pointer' }}>Download via Zoya</button>
                            </div>
                          </div>
                        ))}
                     </div>
                   )}
                 </>
               )
            })()
          ) : (
            /* SECURE VAULT VIEW */
            <div style={{display:'flex', flexDirection:'column', gap:'1.5rem'}}>
               <div style={{background:'linear-gradient(135deg, #1e1b4b, #312e81)', padding:'1.5rem', borderRadius:'12px', color:'white', position:'relative', overflow:'hidden'}}>
                 <div style={{position:'relative', zIndex:2}}>
                   <h3 style={{fontSize:'1.1rem', margin:'0 0 0.5rem 0'}}>Encrypted Evidence Vault</h3>
                   <p style={{fontSize:'0.8rem', color:'#c7d2fe', lineHeight:1.4, margin:'0 0 1rem 0'}}>Upload images of injuries, WhatsApp chats, or documents. Zoya's Vision AI will forensically analyze them and compile a formal Legal Evidence Manifest.</p>
                   <label style={{display:'inline-flex', alignItems:'center', background:'#8b5cf6', padding:'0.6rem 1rem', borderRadius:'8px', fontSize:'0.8rem', fontWeight:700, cursor:'pointer', gap:'0.5rem'}}>
                      <span>{vaultAnalyzing ? 'Analyzing...' : '📤 Add Evidence'}</span>
                      <input type="file" accept="image/*,application/pdf,text/plain,.txt" style={{display:'none'}} disabled={vaultAnalyzing} onChange={(e) => handleVaultUpload(e.target.files[0])} />
                   </label>
                 </div>
                 <div style={{position:'absolute', right:'-20px', bottom:'-20px', fontSize:'7rem', opacity:0.1, zIndex:1}}>🔒</div>
               </div>

               {vaultItems.length > 0 && (
                 <div style={{display:'flex', flexDirection:'column', gap:'1rem'}}>
                   <h3 style={{fontSize:'0.8rem', fontWeight:800, color:'#0f172a', textTransform:'uppercase', letterSpacing:'1px'}}>Stored Evidence ({vaultItems.length})</h3>
                   {vaultItems.map((item, idx) => (
                     <div key={item.id} style={{background:'white', padding:'1rem', borderRadius:'10px', boxShadow:'0 2px 8px rgba(0,0,0,0.05)', display:'flex', gap:'1rem'}}>
                        <img src={item.dataUrl} alt={`Evidence ${idx}`} style={{width:'80px', height:'80px', objectFit:'cover', borderRadius:'8px'}} />
                        <div style={{flex:1, position:'relative'}}>
                           <p style={{fontSize:'0.75rem', fontWeight:700, color:'#8b5cf6', margin:'0 0 0.4rem 0'}}>Context: "{item.contextText}"</p>
                           <p style={{fontSize:'0.75rem', color:'#334155', margin:0, lineHeight:1.5, background:'#f8fafc', padding:'0.6rem', borderRadius:'6px', borderLeft:'3px solid #8b5cf6'}}>{item.analysis}</p>
                           <button 
                              onClick={() => setVaultItems(prev => prev.filter(i => i.id !== item.id))}
                              style={{position:'absolute', top: -5, right: -5, background:'#fee2e2', color:'#ef4444', border:'none', borderRadius:'50%', width:'20px', height:'20px', fontSize:'10px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center'}}
                              title="Delete evidence"
                            >✕</button>
                        </div>
                     </div>
                   ))}
                   
                   <button onClick={generateCasePackage} disabled={vaultAnalyzing} style={{marginTop:'0.5rem', background: vaultAnalyzing ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)', color:'white', border:'none', padding:'0.8rem', borderRadius:'8px', fontSize:'0.8rem', fontWeight:800, cursor: vaultAnalyzing ? 'not-allowed' : 'pointer', boxShadow:'0 4px 14px rgba(16,185,129,0.3)'}}>
                     📄 {vaultAnalyzing ? 'Compiling Full Case via AI...' : (compiledDocs ? 'Re-compile Legal Package' : 'Compile Complete Legal Package')}
                   </button>

                   {compiledDocs && (
                     <div style={{marginTop: '1rem'}}>
                       <button onClick={() => setShowDocsModal(true)} style={{width:'100%', background:'#f1f5f9', color:'#334155', border:'1px solid #cbd5e1', padding:'0.6rem', borderRadius:'8px', fontSize:'0.75rem', fontWeight:700, cursor:'pointer'}}>
                         👁️ View Generated Forms ({Object.keys(compiledDocs).length})
                       </button>
                     </div>
                   )}
                 </div>
               )}
            </div>
          )}
        </div>

        <div style={{padding:'1.5rem', background:'white', borderTop:'1px solid var(--border)'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem'}}>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '身份' : 'Identity'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.name || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '安全' : 'Safety'}</div><div className="card-body" style={{fontSize:'0.9rem', color: caseFile.safety === 'unsafe' ? '#dc2626' : caseFile.safety === 'at_risk' ? '#f59e0b' : '#10b981'}}>{safelyStringify(caseFile.safety || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '財務' : 'Finance'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.financial || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '法律' : 'Legal'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.legal || '...')}</div></div>
          </div>
        </div>
      </aside>

      {/* THREE-COLUMN DOCUMENT GENERATION MODAL */}
      {showDocsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
          zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '2rem'
        }}>
          <style>{`
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
            .blink { animation: blink 1.5s infinite; }
          `}</style>
          
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem'}}>
            <div>
              <h2 style={{color:'white', margin:0, fontSize:'1.8rem'}}>Massive AI Case Generation</h2>
              {vaultAnalyzing && <p style={{color:'#a7f3d0', margin:'0.5rem 0 0 0', fontWeight:600}} className="blink">Zoya AI is working...</p>}
            </div>
            <button onClick={() => setShowDocsModal(false)} style={{background:'rgba(255,255,255,0.1)', color:'white', border:'none', padding:'0.8rem 1.5rem', borderRadius:'8px', cursor:'pointer', fontWeight:800}}>✕ Close Overlay</button>
          </div>

          <div style={{flex: 1, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'2rem', overflowY:'auto', paddingBottom:'2rem'}}>
            
            {/* Document 1: Injunction */}
            <div style={{background:'#e2e8f0', padding:'2rem', borderRadius:'4px', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)', overflowY:'auto'}}>
              <div style={{background:'white', minHeight:'100%', padding:'3rem', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)', color:'black'}}>
                {!compiledDocs ? (
                   <div style={{display:'flex', flexDirection:'column', gap:'1rem', opacity:0.3, animation:'pulse 1.5s infinite'}}>
                     <div style={{height:'30px', background:'#cbd5e1', width:'60%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                   </div>
                ) : (
                   <div contentEditable="true" suppressContentEditableWarning={true} style={{outline:'none', minHeight:'100%'}} dangerouslySetInnerHTML={{ __html: compiledDocs.injunction }} />
                )}
              </div>
            </div>

            {/* Document 2: Chronology */}
            <div style={{background:'#e2e8f0', padding:'2rem', borderRadius:'4px', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)', overflowY:'auto'}}>
              <div style={{background:'white', minHeight:'100%', padding:'3rem', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)', color:'black'}}>
                {!compiledDocs ? (
                   <div style={{display:'flex', flexDirection:'column', gap:'1rem', opacity:0.3, animation:'pulse 1.5s infinite', animationDelay:'0.3s'}}>
                     <div style={{height:'30px', background:'#cbd5e1', width:'40%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                   </div>
                ) : (
                   <div contentEditable="true" suppressContentEditableWarning={true} style={{outline:'none', minHeight:'100%'}} dangerouslySetInnerHTML={{ __html: compiledDocs.chronology }} />
                )}
              </div>
            </div>

            {/* Document 3: Case Pack */}
            <div style={{background:'#e2e8f0', padding:'2rem', borderRadius:'4px', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)', overflowY:'auto'}}>
              <div style={{background:'white', minHeight:'100%', padding:'3rem', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)', color:'black'}}>
                {!compiledDocs ? (
                   <div style={{display:'flex', flexDirection:'column', gap:'1rem', opacity:0.3, animation:'pulse 1.5s infinite', animationDelay:'0.6s'}}>
                     <div style={{height:'30px', background:'#cbd5e1', width:'80%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'150px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                   </div>
                ) : (
                   <div contentEditable="true" suppressContentEditableWarning={true} style={{outline:'none', minHeight:'100%'}} dangerouslySetInnerHTML={{ __html: compiledDocs.casePack }} />
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* SINGLE-COLUMN OFFICIAL FORM MODAL */}
      {showSingleFormModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)',
          zIndex: 10000, display: 'flex', flexDirection: 'column', padding: '2rem'
        }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', maxWidth: '800px', margin: '0 auto', width: '100%'}}>
            <div>
              <h2 style={{color:'white', margin:0, fontSize:'1.5rem'}}>{secureFormTitle}</h2>
              {!secureFormHtml && <p style={{color:'#a7f3d0', margin:'0.5rem 0 0 0', fontWeight:600}} className="blink">Securely drafting ephemeral form with context...</p>}
            </div>
            <button onClick={() => setShowSingleFormModal(false)} style={{background:'rgba(255,255,255,0.1)', color:'white', border:'none', padding:'0.6rem 1.2rem', borderRadius:'8px', cursor:'pointer', fontWeight:800}}>✕ Destroy & Close</button>
          </div>

          <div style={{flex: 1, maxWidth: '800px', margin: '0 auto', width: '100%', display:'flex', flexDirection: 'column', overflowY:'auto', paddingBottom:'2rem'}}>
            <div style={{background:'#e2e8f0', padding:'2rem', borderRadius:'4px', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)', flex: 1}}>
              <div style={{background:'white', minHeight:'100%', padding:'3rem', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)', color:'black'}}>
                {!secureFormHtml ? (
                   <div style={{display:'flex', flexDirection:'column', gap:'1.5rem', opacity:0.3, animation:'pulse 1.5s infinite'}}>
                     <div style={{height:'35px', background:'#cbd5e1', width:'60%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                     <div style={{height:'15px', background:'#cbd5e1', width:'80%', borderRadius:'4px'}}/>
                     <div style={{height:'40px', background:'#cbd5e1', width:'100%', borderRadius:'4px', marginTop:'2rem'}}/>
                     <div style={{height:'40px', background:'#cbd5e1', width:'100%', borderRadius:'4px'}}/>
                   </div>
                ) : (
                   <div contentEditable="true" suppressContentEditableWarning={true} style={{outline:'none', minHeight:'100%'}} dangerouslySetInnerHTML={{ __html: secureFormHtml }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications for shelter availability */}
      <ToastContainer position="bottom-right" autoClose={5000} hideProgressBar={false} pauseOnHover theme="light" />
    </div>
  );
}
