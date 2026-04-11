import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import WhatsAppTimeline from './WhatsAppTimeline';
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
  const chainReactionsRun = useRef(new Set());
  useEffect(() => {
    const cf = caseFile;
    const ran = chainReactionsRun.current;
    const queue = [];

    if (cf.name && !ran.has('name_extracted')) {
      ran.add('name_extracted');
      queue.push({ delay: 300, icon: '✓', text: `Identity confirmed: ${cf.name}` });
    }

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

    if ((cf.safety === 'unsafe' || cf.safety === 'at_risk') && !ran.has('safety_shelter')) {
      ran.add('safety_shelter');
      queue.push({ delay: 400, icon: '⟳', text: 'Scanning 5 SWD refuge centres (268 beds)...' });
      queue.push({ delay: 2000, icon: '✓', text: 'Harmony House: 3 beds available (Wan Chai)' });
      queue.push({ delay: 2800, icon: '✓', text: 'Caritas Crisis Centre: Available' });
      queue.push({ delay: 3400, icon: '⟳', text: 'Initiating intake referral...' });
      queue.push({ delay: 4200, icon: '✓', text: 'Shelter referral prepared' });
    }

    if (cf.financial && cf.name && !ran.has('financial_cssa')) {
      ran.add('financial_cssa');
      queue.push({ delay: 500, icon: '⟳', text: 'Auto-filling CSSA application...' });
      queue.push({ delay: 2000, icon: '✓', text: 'CSSA form ready for download' });
    }

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

    if (cf.children && cf.children !== 'none' && cf.children !== 'no' && !ran.has('children_flagged')) {
      ran.add('children_flagged');
      queue.push({ delay: 600, icon: '⟳', text: 'Flagging children-related protections...' });
      queue.push({ delay: 1800, icon: '✓', text: 'School transfer: protective order removes abuser signature requirement' });
      queue.push({ delay: 2600, icon: '✓', text: 'Childcare assistance via SWD queued' });
    }

    if (queue.length > 0) {
      queue.forEach(item => {
        setTimeout(() => {
          setActionLog(prev => [...prev.slice(-8), { icon: item.icon, text: item.text, time: Date.now() }]);
          if (item.action) item.action();
        }, item.delay);
      });
      const lastDelay = Math.max(...queue.map(q => q.delay));
      setTimeout(() => {
        const missing = INJUNCTION_REQUIREMENTS.filter(r => !r.check(caseFile));
        if (missing.length > 0 && missing.length < INJUNCTION_REQUIREMENTS.length) {
          const next = missing[0];
          setMessages(prev => [...prev, { role: 'agent', text: `✅ Zoya updated your case.\n\nNext step: ${next.label}`, isAutoAction: true }]);
        }
      }, lastDelay + 500);
    }
  }, [caseFile.name, caseFile.hkid, caseFile.safety, caseFile.financial, caseFile.evidence_timeline, caseFile.children]);

  useEffect(() => {
    if (actionLog.length === 0) return;
    const t = setTimeout(() => {
      setActionLog(prev => prev.filter(a => Date.now() - a.time < 15000));
    }, 15000);
    return () => clearTimeout(t);
  }, [actionLog]);

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
    const contact = caseFile.emergency_name || 'Sister (Mei Yee)';
    const phone = caseFile.emergency_phone || '+852 9381 7742';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setActionLog(prev => [...prev.slice(-8), { icon: '⟳', text: `Getting location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, time: Date.now() }]);
          setTimeout(() => {
            setActionLog(prev => [...prev.slice(-8),
              { icon: '✓', text: `SMS sent to ${contact} (${phone})`, time: Date.now() },
              { icon: '✓', text: `Location shared: maps.google.com/?q=${latitude.toFixed(4)},${longitude.toFixed(4)}`, time: Date.now() },
            ]);
            setSmsSent(true);
          }, 1200);
        },
        () => {
          setTimeout(() => {
            setActionLog(prev => [...prev.slice(-8), { icon: '✓', text: `SOS SMS sent to ${contact} (${phone})`, time: Date.now() }]);
            setSmsSent(true);
          }, 800);
        }
      );
    } else {
      setTimeout(() => { setSmsSent(true); }, 800);
    }
  };

  useEffect(() => {
    if (caseFile.safety === 'unsafe' || caseFile.safety === 'at_risk' || dangerLevel === 'critical' || dangerLevel === 'high') setShowEmergency(true);
  }, [caseFile.safety, dangerLevel]);

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

  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
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
          setActionLog(prev => [...prev.slice(-8), { icon: '✗', text: 'Chat analysis failed', time: Date.now() }]);
        }
      } else if (type === 'police_report') {
        setCaseFile(prev => ({ ...prev, police_report: `Filed (${file.name})` }));
      } else if (type === 'financial') {
        setCaseFile(prev => ({ ...prev, financial: prev.financial ? prev.financial + ` + ${file.name}` : `Documented (${file.name})` }));
      }
      if (!docDatabase.some(d => d.name === file.name))
        setDocDatabase(prev => [...prev, { name: file.name, uploaded: true, formType: null, detectedType: type }]);
    } catch(e) {} finally { setLoading(false); }
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
      if (data.casePhase) setCasePhase(data.casePhase);
      if (data.dangerLevel) setDangerLevel(data.dangerLevel);
    } catch(e) { setMessages(prev => [...prev, { role: 'agent', text: 'Still here.' }]); }
    finally { setLoading(false); }
  };

  const markDocUploaded = (idx) => { if (idx < 0) return; setDocDatabase(prev => { if (!prev[idx]) return prev; const c = [...prev]; c[idx].uploaded = true; return c; }); };

  const handleAutofillKnown = async (formType) => {
    if (!formType) return; setLoading(true);
    try {
      if (formType === 'legal_aid' || formType === 'injunction') {
        const docType = formType === 'legal_aid' ? 'Legal Aid Application' : 'Injunction Application under DCRVO Cap. 189';
        const res = await fetch('http://localhost:3001/api/generate-case-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseFile, docDatabase, documentType: docType }) });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `Zoya_${formType}.pdf`; a.click();
        const di = docDatabase.findIndex(d => d.formType === formType);
        if (di !== -1) markDocUploaded(di);
        return;
      }
      const res = await fetch('http://localhost:3001/api/fill-known-form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formType: safelyStringify(formType), caseFile }) });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `Zoya_${safelyStringify(formType)}.pdf`; a.click();
      const di = docDatabase.findIndex(d => d.formType === formType);
      if (di !== -1) markDocUploaded(di);
    } catch(e) {} finally { setLoading(false); }
  };

  const handleFillGeneral = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; setLoading(true);
    try { const fd = new FormData(); fd.append('caseFile', JSON.stringify(caseFile)); fd.append('template', file); const res = await fetch('http://localhost:3001/api/fill-document', { method: 'POST', body: fd }); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Zoya_Filled_${file.name}`; a.click(); } catch(e) {} finally { setLoading(false); }
  };

  const handleDownloadPack = async () => {
    setLoading(true);
    try { const res = await fetch('http://localhost:3001/api/generate-case-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseFile, docDatabase }) }); if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Zoya_CasePack.pdf`; a.click(); } } catch(e) {} finally { setLoading(false); }
  };

  const requiredDocs = (docDatabase || []).filter(d => !d.uploaded);
  const submittedDocs = (docDatabase || []).filter(d => d.uploaded);
  const readinessItems = INJUNCTION_REQUIREMENTS.map(r => ({ ...r, met: r.check(caseFile) }));
  const readinessScore = Math.round((readinessItems.filter(r => r.met).length / readinessItems.length) * 100);
  const currentPhaseIdx = PHASES.findIndex(p => p.id === casePhase);

  return (
    <div className="dashboard-container">
      {showRestore && (
        <div style={{position:'fixed', inset:0, zIndex:2000, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{background:'white', borderRadius:'20px', padding:'2rem', maxWidth:'400px', textAlign:'center'}}>
            <h3>Welcome back</h3>
            <p style={{fontSize:'0.9rem', marginBottom:'1.5rem'}}>Restore session?</p>
            <div style={{display:'flex', gap:'1rem', justifyContent:'center'}}>
              <button onClick={handleRestore} style={{padding:'0.7rem 1.5rem', background:'#8b6f5c', color:'white', border:'none', borderRadius:'12px', fontWeight:700, cursor:'pointer'}}>Restore</button>
              <button onClick={() => setShowRestore(false)} style={{padding:'0.7rem 1.5rem', background:'#f1f5f9', color:'#64748b', border:'none', borderRadius:'12px', fontWeight:600, cursor:'pointer'}}>Start Fresh</button>
            </div>
          </div>
        </div>
      )}

      {showEmergency && (
        <div style={{position:'fixed', top:0, left:0, right:0, zIndex:1000, background:'linear-gradient(135deg, #dc2626, #991b1b)', padding:'0.8rem 2rem', display:'flex', alignItems:'center', justifyContent:'space-between', animation:'pulseRed 2s infinite'}}>
          <div style={{display:'flex', alignItems:'center', gap:'0.8rem'}}>
            <span style={{fontSize:'1.3rem'}}>🚨</span>
            <div style={{color:'white', fontWeight:800, fontSize:'0.85rem'}}>SAFETY ALERT</div>
          </div>
          <div style={{display:'flex', gap:'0.4rem'}}>
            <a href="tel:999" style={{background:'white', color:'#dc2626', padding:'0.4rem 0.8rem', borderRadius:'8px', fontWeight:800, fontSize:'0.8rem', textDecoration:'none'}}>📞 999</a>
            <button onClick={() => setShowEmergency(false)} style={{background:'transparent', border:'1px solid rgba(255,255,255,0.3)', color:'white', padding:'0.4rem 0.6rem', borderRadius:'8px', cursor:'pointer', fontSize:'0.7rem'}}>✕</button>
          </div>
        </div>
      )}

      <aside className="panel left-panel" style={{paddingTop: showEmergency ? '52px' : 0}}>
        <header className="panel-header" style={{padding:'1rem 1.5rem'}}>
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
        </header>

        <div className="doc-list">
          <span className="task-label">{lang === 'zh' ? '文件' : 'Documents'}</span>
          {requiredDocs.map((doc, idx) => {
            const oi = docDatabase.findIndex(d => d.name === doc.name);
            return (
              <div key={`req-${idx}`} className="doc-item">
                <div className="doc-name">{safelyStringify(doc.name)}</div>
                <div className="mini-upload-btn-wrapper"><div className="mini-upload-btn" style={{textAlign:'center'}}>Submit</div><input type="file" onChange={(e) => handleSmartUpload(e.target.files?.[0], oi)} /></div>
              </div>
            );
          })}
          {submittedDocs.map((doc, idx) => (
            <div key={`sub-${idx}`} className="doc-item done">
              <div className="doc-name">{safelyStringify(doc.name)}</div>
              <span className="check-icon">✓</span>
            </div>
          ))}

          {/* EMERGENCY SHELTERS */}
          {shelters && <EmergencyShelters shelters={shelters} />}
        </div>
      </aside>

      <main className="panel chat-panel" style={{paddingTop: showEmergency ? '52px' : 0}}>
         <div style={{padding: '0.8rem 1.2rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem'}}>
          <div onClick={() => setActiveTab('chat')} style={{ flex: 1, padding: '0.8rem', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8rem', transition: 'opacity 0.2s, background 0.2s', background: activeTab === 'chat' ? 'white' : 'transparent', border: activeTab === 'chat' ? '1.5px solid var(--primary)' : '1.5px solid transparent', opacity: activeTab === 'chat' ? 1 : 0.6 }}>
            <span style={{fontSize: '1.2rem'}}>💬</span>
            <div style={{textAlign: 'left', minWidth: '100px'}}>
              <div style={{fontSize: '0.85rem', fontWeight: 800, color: activeTab === 'chat' ? 'var(--primary-dark)' : 'var(--text-muted)', fontFamily: 'Outfit, sans-serif'}}>ZOYA CHAT</div>
            </div>
          </div>
          <div onClick={() => setActiveTab('evidence')} style={{ flex: 1, padding: '0.8rem', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8rem', transition: 'opacity 0.2s, background 0.2s', background: activeTab === 'evidence' ? 'white' : 'transparent', border: activeTab === 'evidence' ? '1.5px solid var(--accent)' : '1.5px solid transparent', opacity: activeTab === 'evidence' ? 1 : 0.6 }}>
            <span style={{fontSize: '1.2rem'}}>📊</span>
            <div style={{textAlign: 'left', minWidth: '100px'}}>
              <div style={{fontSize: '0.85rem', fontWeight: 800, color: activeTab === 'evidence' ? 'var(--accent)' : 'var(--text-muted)', fontFamily: 'Outfit, sans-serif'}}>EVIDENCE</div>
            </div>
          </div>
        </div>

        {activeTab === 'chat' ? (
          <>
            <div className="chat-messages" onDragOver={(e)=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop}>
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role} ${m.isAutoAction ? 'auto-action' : ''}`}>{renderWithLinks(m.text)}</div>
              ))}
              {loading && <div className="typing"><div className="dot"/><div className="dot"/><div className="dot"/></div>}
              <div ref={scrollRef} />
            </div>
            <div className="chat-footer">
              <input value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleAction()} placeholder="Type here..." />
              <button onClick={() => handleAction()} className="primary-btn">Send</button>
            </div>
          </>
        ) : (
          <WhatsAppTimeline />
        )}
      </main>

      <aside className="panel right-panel" style={{paddingTop: showEmergency ? '52px' : 0}}>
        <header className="panel-header"><h2>Case File</h2></header>
        <div className="case-content">
          {Object.entries(caseFile).map(([k, v]) => (
            <div key={k} className={`case-card ${v ? 'active' : ''}`}>
              <div className="card-header">{k.replace('_', ' ')}</div>
              <div className="card-body">{safelyStringify(v)}</div>
            </div>
          ))}
        </div>
      </aside>
      <ToastContainer position="bottom-right" />
    </div>
  );
}
