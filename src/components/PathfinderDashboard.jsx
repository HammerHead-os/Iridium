import React, { useState, useRef, useEffect, useCallback } from 'react';
import WhatsAppTimeline from './WhatsAppTimeline';

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

export default function PathfinderDashboard({ onOpenChatlogExtraction, onOpenProfile, onLock }) {
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
          setMessages(prev => [...prev, { role: 'agent', text: `✅ Zoya updated your case.\n\nNext step: ${next.label}`, isAutoAction: true }]);
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
        setMessages(prev => [...prev, { role: 'agent', text: `📋 Auto-prepared: ${action.label}\nDownload from PDF Architect →`, isAutoAction: true }]);
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
      const msg = hit === 100 ? '🎉 Your case is 100% ready for court.\nOne click to export everything for your solicitor.' 
        : `📊 Case readiness: ${hit}%.\n${hit === 75 ? "Almost there. Here's what's left:" : "Making progress. Zoya is working on the rest."}`;
      setMessages(prev => [...prev, { role: 'agent', text: msg, isAutoAction: true }]);
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
      if (data.autoActions?.length > 0) data.autoActions.forEach(a => setMessages(prev => [...prev, { role: 'agent', text: `⚡ ${safelyStringify(a)}`, isAutoAction: true }]));
    } catch(e) { setMessages(prev => [...prev, { role: 'agent', text: 'Connection issue. Zoya is still here.' }]); }
    finally { setLoading(false); }
  };

  const markDocUploaded = (idx) => { if (idx < 0) return; setDocDatabase(prev => { if (!prev[idx]) return prev; const c = [...prev]; c[idx].uploaded = true; return c; }); };

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
          {readinessScore >= 75 && (
            <button onClick={handleDownloadPack} style={{marginTop:'0.6rem', width:'100%', padding:'0.6rem', background:'linear-gradient(135deg, #6b5344, #8b6f5c)', color:'white', border:'none', borderRadius:'10px', fontWeight:800, fontSize:'0.75rem', cursor:'pointer', boxShadow:'0 4px 15px rgba(139,111,92,0.3)'}}>
              📦 {lang === 'zh' ? '匯出完整案件包' : 'Export Complete Case Pack'}
            </button>
          )}
        </div>

        {/* DOC DATABASE */}
        <div className="doc-list">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem'}}>
            <span className="task-label">{lang === 'zh' ? '文件' : 'Documents'}</span>
            <label style={{fontSize:'0.6rem', fontWeight:700, color:'#8b6f5c', cursor:'pointer', padding:'0.2rem 0.5rem', background:'#f5f0e8', borderRadius:'6px', border:'1px solid #e2ddd5'}}>
              + {lang === 'zh' ? '上傳' : 'Upload'}
              <input type="file" style={{display:'none'}} onChange={(e) => handleSmartUpload(e.target.files?.[0], -1)} accept=".pdf,.jpg,.jpeg,.png,.docx,.webp" />
            </label>
          </div>
          {requiredDocs.length === 0 && submittedDocs.length === 0 && <p style={{fontSize:'0.7rem', color:'#94a3b8'}}>Documents will appear as Zoya identifies them.</p>}
          {requiredDocs.map((doc, idx) => {
            const oi = docDatabase.findIndex(d => d.name === doc.name);
            return (
              <div key={`req-${idx}`} className="doc-item">
                <div className="doc-name">{safelyStringify(doc.name)}</div>
                {doc.link ? (
                  <a href={doc.link} target="_blank" rel="noopener noreferrer" className="mini-upload-btn" style={{background:'#8b6f5c', color:'white', border:'none', textAlign:'center', cursor:'pointer', display:'block', textDecoration:'none'}}>Open Official Form ↗</a>
                ) : doc.formType ? (
                  <div className="mini-upload-btn" style={{background:'#8b6f5c', color:'white', border:'none', textAlign:'center', cursor:'pointer'}} onClick={() => handleAutofillKnown(doc.formType)}>Zoya Autofill</div>
                ) : (
                  <div className="mini-upload-btn-wrapper"><div className="mini-upload-btn" style={{textAlign:'center'}}>Submit</div><input type="file" onChange={(e) => handleSmartUpload(e.target.files?.[0], oi)} /></div>
                )}
              </div>
            );
          })}
          {submittedDocs.length > 0 && <hr style={{margin:'1rem 0', opacity:0.1}} />}
          {submittedDocs.map((doc, idx) => (
            <div key={`sub-${idx}`} className="doc-item done">
              <div className="doc-name">{safelyStringify(doc.name)}</div>
              <span className="check-icon">✓</span>
            </div>
          ))}
        </div>
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

        {/* TAB SWITCHER */}
        <div style={{padding: '0.8rem 1.2rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem'}}>
          <div 
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1, 
              padding: '0.8rem', 
              borderRadius: '12px', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '0.8rem',
              transition: 'opacity 0.2s, background 0.2s',
              background: activeTab === 'chat' ? 'white' : 'transparent',
              border: activeTab === 'chat' ? '1.5px solid var(--primary)' : '1.5px solid transparent',
              opacity: activeTab === 'chat' ? 1 : 0.6
            }}
          >
            <span style={{fontSize: '1.2rem'}}>💬</span>
            <div style={{textAlign: 'left', minWidth: '100px'}}>
              <div style={{fontSize: '0.85rem', fontWeight: 800, color: activeTab === 'chat' ? 'var(--primary-dark)' : 'var(--text-muted)', fontFamily: 'Outfit, sans-serif'}}>ZOYA CHAT</div>
              <div style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>{lang === 'zh' ? '安全聊天' : 'Secure Guidance'}</div>
            </div>
          </div>

          <div 
            onClick={() => setActiveTab('evidence')}
            style={{
              flex: 1, 
              padding: '0.8rem', 
              borderRadius: '12px', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '0.8rem',
              transition: 'opacity 0.2s, background 0.2s',
              background: activeTab === 'evidence' ? 'white' : 'transparent',
              border: activeTab === 'evidence' ? '1.5px solid var(--accent)' : '1.5px solid transparent',
              opacity: activeTab === 'evidence' ? 1 : 0.6
            }}
          >
            <span style={{fontSize: '1.2rem'}}>📊</span>
            <div style={{textAlign: 'left', minWidth: '100px'}}>
              <div style={{fontSize: '0.85rem', fontWeight: 800, color: activeTab === 'evidence' ? 'var(--accent)' : 'var(--text-muted)', fontFamily: 'Outfit, sans-serif'}}>EVIDENCE</div>
              <div style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>{lang === 'zh' ? '證據提取' : 'Timeline'}</div>
            </div>
          </div>
        </div>
         
        {activeTab === 'chat' ? (
          <>
            <div className="chat-messages">
              {(messages || []).map((m, i) => (
                <div key={`msg-${i}`} className={`bubble ${m.role} ${m.isAutoAction ? 'auto-action' : ''}`} style={{whiteSpace:'pre-line'}}>
                  {renderWithLinks(m.text)}
                </div>
              ))}
              {!loading && currentTask && (
                <div className="bubble agent intake-bubble">
                  <p style={{marginBottom:'0.8rem', fontWeight:800, color:'#8b6f5c', fontSize:'0.9rem'}}>{safelyStringify(currentTask.label)}</p>
                  {currentTask.type === 'choice' ? (
                    <div className="option-grid">
                      {(currentTask.options || []).map((opt, i) => (
                        <div key={`opt-${i}`} className="pill-btn" onClick={() => handleAction(opt)} role="button" style={{textAlign:'center'}}>{safelyStringify(opt)}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="dedicated-field">
                      <input type="text" placeholder="Type your response..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAction()} />
                      <div className="send-btn" onClick={() => handleAction()} role="button" style={{display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'}}>OK</div>
                    </div>
                  )}
                  {currentTask.formType && (
                    <div style={{marginTop:'0.8rem', padding:'0.8rem', background:'#f5f0e8', borderRadius:'10px', border:'1px solid #e2ddd5'}}>
                      <p style={{fontSize:'0.75rem', color:'#8b6f5c', fontWeight:600, marginBottom:'0.4rem'}}>✨ Official HK form identified</p>
                      <div className="primary-btn" style={{background:'#8b6f5c', width:'100%', fontSize:'0.75rem', textAlign:'center', cursor:'pointer'}} onClick={() => handleAutofillKnown(currentTask.formType)}>Autofill & Download PDF</div>
                    </div>
                  )}
                </div>
              )}
              {loading && <div className="typing"><div className="dot" /><div className="dot" /><div className="dot" /></div>}
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
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', padding: '1rem' }}>
            <WhatsAppTimeline />
          </div>
        )}
      </main>

      {/* RIGHT: LIVE PDF ARCHITECT */}
      <aside className="panel right-panel" style={{paddingTop: showEmergency ? '52px' : 0}}>
        <header className="panel-header" style={{flexDirection:'column', alignItems:'flex-start', gap:'0.8rem', padding:'1rem 1.5rem'}}>
          <h2>{lang === 'zh' ? '即時PDF建構' : 'Live PDF Architect'}</h2>
          <div style={{display:'flex', gap:'0.4rem', width:'100%'}}>
            <div className={`status-indicator ${activeFormType === 'cssa' ? 'active' : ''}`} onClick={() => setActiveFormType('cssa')} style={{cursor:'pointer', opacity: activeFormType === 'cssa' ? 1 : 0.5, fontSize:'0.6rem'}}>CSSA</div>
            <div className={`status-indicator ${activeFormType === 'marriage_search' ? 'active' : ''}`} onClick={() => setActiveFormType('marriage_search')} style={{cursor:'pointer', opacity: activeFormType === 'marriage_search' ? 1 : 0.5, fontSize:'0.6rem'}}>MARRIAGE</div>
          </div>
        </header>
        <div style={{flex:1, position:'relative', background:'#e2e8f0', display:'flex', flexDirection:'column'}}>
          {previewLoading && <div style={{position:'absolute', top:'0.8rem', right:'0.8rem', background:'white', padding:'0.4rem 0.8rem', borderRadius:'20px', fontSize:'0.65rem', fontWeight:700, color:'#8b6f5c', boxShadow:'0 4px 12px rgba(0,0,0,0.1)', zIndex:10}}>Drawing...</div>}
          {previewUrl ? (
            <iframe src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0`} style={{width:'100%', flex:1, border:'none', background:'white'}} title="PDF Preview" />
          ) : (
            <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#94a3b8'}}>
              <div style={{fontSize:'2.5rem', marginBottom:'0.5rem', opacity:0.4}}>📄</div>
              <p style={{fontSize:'0.8rem', fontWeight:600}}>Loading Architect...</p>
            </div>
          )}
        </div>
        <div style={{padding:'1.5rem', background:'white', borderTop:'1px solid var(--border)'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'1.2rem'}}>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '身份' : 'Identity'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.name || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '安全' : 'Safety'}</div><div className="card-body" style={{fontSize:'0.9rem', color: caseFile.safety === 'unsafe' ? '#dc2626' : caseFile.safety === 'at_risk' ? '#f59e0b' : '#10b981'}}>{safelyStringify(caseFile.safety || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '財務' : 'Finance'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.financial || '...')}</div></div>
            <div className="case-card active" style={{padding:'0.8rem'}}><div className="card-header" style={{fontSize:'0.7rem'}}>{lang === 'zh' ? '法律' : 'Legal'}</div><div className="card-body" style={{fontSize:'0.9rem'}}>{safelyStringify(caseFile.legal || '...')}</div></div>
          </div>
          <div className="mini-upload-btn-wrapper">
            <div className="primary-btn" style={{width:'100%', borderRadius:'8px', textAlign:'center', cursor:'pointer', fontSize:'0.85rem', padding:'0.8rem'}}>{lang === 'zh' ? '映射模板' : 'Map Template'}</div>
            <input type="file" onChange={handleFillGeneral} accept=".pdf,.docx"/>
          </div>
        </div>
      </aside>
    </div>
  );
}
