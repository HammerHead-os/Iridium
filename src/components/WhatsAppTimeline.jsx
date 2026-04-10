import React, { useState, useEffect } from 'react';
import { extractTimeline } from '../api';

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ABUSE_COLORS = {
  physical: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '🔴 Physical' },
  emotional: { bg: '#fefce8', border: '#fde047', text: '#854d0e', label: '🟡 Emotional' },
  financial: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', label: '🟠 Financial' },
  coercive_control: { bg: '#fdf4ff', border: '#e879f9', text: '#86198f', label: '🟣 Coercive Control' },
  sexual: { bg: '#fef2f2', border: '#f87171', text: '#7f1d1d', label: '🔴 Sexual' },
  threats: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '⚠️ Threats' },
  default: { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', label: '⬜ Other' },
};

export default function WhatsAppTimeline() {
  const [rawText, setRawText] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [error, setError] = useState(null);
  const [uploadedName, setUploadedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('whatsapp_timeline');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setTimeline(data.timeline || []);
        setLanguage(data.language || '');
        setUploadedName(data.uploadedName || '');
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (timeline.length > 0) {
      localStorage.setItem('whatsapp_timeline', JSON.stringify({ timeline, language, uploadedName, savedAt: new Date().toISOString() }));
    }
  }, [timeline, language, uploadedName]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setUploadedName(file.name);
    setTimeline([]);
    setError(null);
  };

  const handleClearAll = () => {
    setRawText(''); setTimeline([]); setError(null); setUploadedName(''); setLanguage('');
    localStorage.removeItem('whatsapp_timeline');
  };

  const handleParseClick = async () => {
    if (!rawText.trim()) { setError('Please paste or upload a conversation text before parsing.'); return; }
    try {
      setBusy(true); setError(null);
      const data = await extractTimeline(rawText);
      setTimeline(data.timeline || []);
      setLanguage(data.language || 'unknown');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse the text.');
    } finally { setBusy(false); }
  };

  // Detect escalation patterns
  const getEscalationAnalysis = () => {
    if (timeline.length < 2) return null;
    const sorted = [...timeline].sort((a, b) => new Date(a.date) - new Date(b.date));
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
    
    const avgGapFirst = firstHalf.length > 1 ? (new Date(firstHalf[firstHalf.length-1].date) - new Date(firstHalf[0].date)) / firstHalf.length : 0;
    const avgGapSecond = secondHalf.length > 1 ? (new Date(secondHalf[secondHalf.length-1].date) - new Date(secondHalf[0].date)) / secondHalf.length : 0;
    
    if (avgGapSecond > 0 && avgGapFirst > 0 && avgGapSecond < avgGapFirst * 0.7) {
      return { escalating: true, message: 'Incidents are becoming more frequent over time — this is an escalation pattern.' };
    }
    return { escalating: false, message: 'No clear escalation pattern detected in frequency.' };
  };

  // Generate court-ready chronology PDF (text format)
  const handleDownloadCourtReport = () => {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('         INCIDENT CHRONOLOGY — PREPARED FOR LEGAL REVIEW');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`Prepared: ${new Date().toLocaleString('en-GB')}`);
    lines.push(`Total Documented Incidents: ${timeline.length}`);
    lines.push(`Language Detected: ${language}`);
    
    const escalation = getEscalationAnalysis();
    if (escalation) lines.push(`Escalation Assessment: ${escalation.message}`);
    
    // Abuse type summary
    const typeCounts = {};
    timeline.forEach(e => {
      const types = e.abuse_types || e.keywords || [];
      types.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
    });
    lines.push('');
    lines.push('ABUSE TYPE SUMMARY:');
    Object.entries(typeCounts).sort((a,b) => b[1]-a[1]).forEach(([type, count]) => {
      lines.push(`  • ${type}: ${count} incident(s)`);
    });
    
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                    DETAILED INCIDENT LOG');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    const sorted = [...timeline].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach((entry, i) => {
      lines.push(`INCIDENT ${i + 1} — ${entry.date}`);
      lines.push(`Summary: ${entry.summary}`);
      if (entry.abuse_types?.length) lines.push(`Classification: ${entry.abuse_types.join(', ')}`);
      if (entry.keywords?.length) lines.push(`Key Indicators: ${entry.keywords.join(', ')}`);
      if (entry.quotes?.length) {
        lines.push('Direct Evidence:');
        entry.quotes.forEach(q => lines.push(`  > "${q}"`));
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('DISCLAIMER: This chronology is a documentation aid generated');
    lines.push('from chat records. It is not legal advice. All quotes are');
    lines.push('extracted verbatim from the source conversation.');
    lines.push('Consult qualified DV services for formal legal guidance.');
    lines.push('═══════════════════════════════════════════════════════════════');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Court_Chronology_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const escalation = getEscalationAnalysis();

  return (
    <section style={{maxWidth:'900px', margin:'0 auto', padding:'2rem', fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'}}>
      <div style={{marginBottom:'2rem', textAlign:'center'}}>
        <h2 style={{color:'#1f2937', marginBottom:'0.5rem'}}>Evidence Timeline Extractor</h2>
        <p style={{color:'#6b7280', fontSize:'0.95rem'}}>Upload chat exports to auto-generate a court-ready incident chronology with abuse classification</p>
      </div>

      <div style={{display:'flex', gap:'1rem', marginBottom:'1.5rem', flexWrap:'wrap', justifyContent:'center'}}>
        <label style={{padding:'0.75rem 1.5rem', backgroundColor:'#3b82f6', color:'white', borderRadius:'8px', cursor:'pointer', fontWeight:'600', border:'none'}}>
          Select .txt file
          <input type="file" accept=".txt,text/plain" onChange={handleFileChange} style={{display:'none'}} />
        </label>
        <button onClick={handleParseClick} disabled={!rawText.trim() || busy} style={{padding:'0.75rem 1.5rem', backgroundColor: busy ? '#9ca3af' : '#10b981', color:'white', border:'none', borderRadius:'8px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight:'600', fontSize:'1rem'}}>
          {busy ? '⏳ Analyzing...' : '📊 Analyze & Classify'}
        </button>
      </div>

      <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Paste conversation text here..." style={{width:'100%', height:'200px', padding:'1rem', border:'1px solid #d1d5db', borderRadius:'8px', fontFamily:'monospace', fontSize:'0.9rem', marginBottom:'1rem', resize:'vertical'}} />

      {uploadedName && <div style={{padding:'0.75rem', backgroundColor:'#d1fae5', color:'#065f46', borderRadius:'6px', marginBottom:'1rem', fontSize:'0.9rem'}}>✓ Loaded: {uploadedName}</div>}
      {error && <div style={{padding:'1rem', backgroundColor:'#fee2e2', color:'#991b1b', borderRadius:'8px', marginBottom:'1rem', border:'1px solid #fca5a5'}}>⚠️ {error}</div>}

      {timeline.length > 0 && (
        <div>
          {/* Summary Panel */}
          <div style={{padding:'1.5rem', backgroundColor:'#eff6ff', borderRadius:'12px', marginBottom:'1.5rem', border:'1px solid #bfdbfe'}}>
            <h3 style={{color:'#1e40af', marginTop:0, marginBottom:'1rem'}}>Analysis Summary</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem', marginBottom:'1rem'}}>
              <div style={{background:'white', padding:'1rem', borderRadius:'8px', textAlign:'center'}}>
                <div style={{fontSize:'1.8rem', fontWeight:800, color:'#1e40af'}}>{timeline.length}</div>
                <div style={{fontSize:'0.75rem', color:'#6b7280'}}>Incidents</div>
              </div>
              <div style={{background:'white', padding:'1rem', borderRadius:'8px', textAlign:'center'}}>
                <div style={{fontSize:'1.8rem', fontWeight:800, color:'#1e40af'}}>{new Set(timeline.flatMap(e => e.abuse_types || e.keywords || [])).size}</div>
                <div style={{fontSize:'0.75rem', color:'#6b7280'}}>Abuse Types</div>
              </div>
              <div style={{background:'white', padding:'1rem', borderRadius:'8px', textAlign:'center'}}>
                <div style={{fontSize:'1.8rem', fontWeight:800, color: escalation?.escalating ? '#dc2626' : '#10b981'}}>{escalation?.escalating ? '⚠️' : '—'}</div>
                <div style={{fontSize:'0.75rem', color:'#6b7280'}}>Escalation</div>
              </div>
            </div>
            
            {escalation?.escalating && (
              <div style={{padding:'0.8rem', background:'#fef2f2', borderRadius:'8px', border:'1px solid #fca5a5', marginBottom:'1rem'}}>
                <span style={{fontSize:'0.85rem', color:'#991b1b', fontWeight:600}}>⚠️ {escalation.message}</span>
              </div>
            )}

            <div style={{display:'flex', gap:'1rem', flexWrap:'wrap'}}>
              <button onClick={handleDownloadCourtReport} style={{padding:'0.75rem 1.5rem', backgroundColor:'#1e40af', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'600'}}>
                📥 Download Court Chronology
              </button>
              <button onClick={handleClearAll} style={{padding:'0.75rem 1.5rem', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:'600'}}>
                🗑️ Clear All
              </button>
            </div>
          </div>

          {/* Timeline Cards */}
          <div style={{display:'flex', flexDirection:'column', gap:'1rem'}}>
            {[...timeline].sort((a, b) => new Date(a.date) - new Date(b.date)).map((entry, index) => {
              const types = entry.abuse_types || [];
              const primaryType = types[0] || 'default';
              const colors = ABUSE_COLORS[primaryType] || ABUSE_COLORS.default;
              
              return (
                <article key={index} style={{padding:'1.5rem', backgroundColor:'white', borderRadius:'12px', border:`2px solid ${colors.border}`, boxShadow:'0 1px 3px rgba(0,0,0,0.1)', borderLeft:`6px solid ${colors.border}`}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem', paddingBottom:'0.75rem', borderBottom:'1px solid #f3f4f6'}}>
                    <strong style={{fontSize:'1.1rem', color:'#1f2937'}}>{formatDate(entry.date)}</strong>
                    <div style={{display:'flex', gap:'0.4rem'}}>
                      {types.map((type, i) => {
                        const c = ABUSE_COLORS[type] || ABUSE_COLORS.default;
                        return <span key={i} style={{padding:'0.2rem 0.6rem', background:c.bg, color:c.text, borderRadius:'20px', fontSize:'0.7rem', fontWeight:700, border:`1px solid ${c.border}`}}>{c.label}</span>;
                      })}
                    </div>
                  </div>
                  <p style={{margin:'0.75rem 0', color:'#374151', lineHeight:1.6}}>{entry.summary}</p>
                  {entry.keywords?.length > 0 && (
                    <div style={{marginTop:'0.75rem'}}>
                      <span style={{color:'#6b7280', fontSize:'0.8rem', fontWeight:'600'}}>Indicators: </span>
                      {entry.keywords.map((kw, i) => (
                        <span key={i} style={{display:'inline-block', padding:'0.2rem 0.6rem', backgroundColor:'#fef08a', color:'#92400e', borderRadius:'20px', fontSize:'0.8rem', fontWeight:'500', marginRight:'0.4rem', marginTop:'0.3rem'}}>{kw}</span>
                      ))}
                    </div>
                  )}
                  {entry.quotes?.length > 0 && (
                    <div style={{marginTop:'1rem', paddingTop:'1rem', borderTop:'1px solid #f3f4f6'}}>
                      <span style={{color:'#6b7280', fontSize:'0.8rem', fontWeight:'600', display:'block', marginBottom:'0.5rem'}}>📝 Direct Evidence:</span>
                      {entry.quotes.map((quote, i) => (
                        <blockquote key={i} style={{margin:'0 0 0.5rem 0', paddingLeft:'0.75rem', borderLeft:'3px solid #dc2626', color:'#7f1d1d', fontSize:'0.9rem', fontStyle:'italic', backgroundColor:'#fef2f2', padding:'0.75rem', borderRadius:'4px'}}>
                          "{quote}"
                        </blockquote>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <div style={{marginTop:'2rem', padding:'1rem', backgroundColor:'#fef3c7', borderRadius:'8px', border:'1px solid #fcd34d', fontSize:'0.85rem', color:'#78350f'}}>
        <strong>🛡️ Privacy:</strong> All analysis is performed server-side. Content is processed only to extract timeline data and is not stored.
      </div>
      <div style={{marginTop:'1rem', padding:'1rem', backgroundColor:'#f0fdf4', borderRadius:'8px', border:'1px solid #bbf7d0', fontSize:'0.85rem', color:'#166534'}}>
        <strong>⚖️ Legal Disclaimer:</strong> This tool is a documentation aid only. Always consult qualified HK domestic violence services for formal guidance.
      </div>
    </section>
  );
}
