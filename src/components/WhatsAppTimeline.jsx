import React, { useState, useEffect } from 'react';
import { extractTimeline } from '../api';

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function WhatsAppTimeline() {
  const [rawText, setRawText] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [error, setError] = useState(null);
  const [uploadedName, setUploadedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState('');

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('whatsapp_timeline');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setTimeline(data.timeline || []);
        setLanguage(data.language || '');
        setUploadedName(data.uploadedName || '');
      } catch (e) {
        console.error('Failed to load saved timeline:', e);
      }
    }
  }, []);

  // Save to localStorage when timeline changes
  useEffect(() => {
    if (timeline.length > 0) {
      localStorage.setItem('whatsapp_timeline', JSON.stringify({
        timeline,
        language,
        uploadedName,
        savedAt: new Date().toISOString(),
      }));
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
    setRawText('');
    setTimeline([]);
    setError(null);
    setUploadedName('');
    setLanguage('');
    localStorage.removeItem('whatsapp_timeline');
  };

  const handleParseClick = async () => {
    if (!rawText.trim()) {
      setError('Please paste or upload a conversation text before parsing.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const data = await extractTimeline(rawText);
      setTimeline(data.timeline || []);
      setLanguage(data.language || 'unknown');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse the text.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadTimeline = () => {
    const lines = [];
    lines.push('Domestic Violence Incident Timeline Report');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Language detected: ${language}`);
    lines.push('');
    lines.push('================================================================================');
    lines.push('');

    for (const entry of timeline) {
      lines.push(`Date: ${entry.date}`);
      lines.push(`Incident: ${entry.summary}`);
      if (entry.keywords && entry.keywords.length > 0) {
        lines.push(`Key indicators: ${entry.keywords.join(', ')}`);
      }
      if (entry.quotes && entry.quotes.length > 0) {
        lines.push('');
        lines.push('Evidence (Direct Quotes):');
        for (const quote of entry.quotes) {
          lines.push(`  > "${quote}"`);
        }
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push('================================================================================');
    lines.push('Disclaimer: This report is a documentation aid only. It is not legal advice.');
    lines.push('Consult qualified domestic violence services for formal guidance.');

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeline-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section style={{
      maxWidth: '900px',
      margin: '0 auto',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#1f2937', marginBottom: '0.5rem' }}>Extract Abuse Timeline from Chat</h2>
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          Upload a WhatsApp export or any conversation text to create a documented incident timeline
        </p>
      </div>

      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        justifyContent: 'center'
      }}>
        <label style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: '#3b82f6',
          color: 'white',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: '600',
          border: 'none'
        }}>
          Select .txt file
          <input 
            type="file" 
            accept=".txt,text/plain" 
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </label>
        <button 
          onClick={handleParseClick}
          disabled={!rawText.trim() || busy}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: busy ? '#9ca3af' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            fontSize: '1rem'
          }}
        >
          {busy ? '⏳ Analyzing...' : '📊 Analyze Timeline'}
        </button>
      </div>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Paste conversation text here from WhatsApp export, free-form notes, or any chat format..."
        style={{
          width: '100%',
          height: '250px',
          padding: '1rem',
          border: '1px solid #d1d5db',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          marginBottom: '1rem',
          resize: 'vertical',
          fontFamily: 'monospace'
        }}
      />

      {uploadedName && (
        <div style={{
          padding: '0.75rem',
          backgroundColor: '#d1fae5',
          color: '#065f46',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.9rem'
        }}>
          ✓ Loaded: {uploadedName}
        </div>
      )}

      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '8px',
          marginBottom: '1rem',
          border: '1px solid #fca5a5'
        }}>
          ⚠️ {error}
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <div style={{
            padding: '1.5rem',
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #bfdbfe'
          }}>
            <h3 style={{ color: '#1e40af', marginTop: 0 }}>Timeline Summary</h3>
            <p style={{ margin: '0.5rem 0', color: '#1f2937' }}>
              {formatCount(timeline.length, 'incident day', 'incident days')} documented
            </p>
            <p style={{ margin: '0.5rem 0', color: '#6b7280', fontSize: '0.9rem' }}>
              Language: {language || 'Unknown'}
            </p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button 
                onClick={handleDownloadTimeline}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#1e40af',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                📥 Download Report
              </button>
              <button 
                onClick={handleClearAll}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                🗑️ Clear All
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {timeline.map((entry, index) => (
              <article key={index} style={{
                padding: '1.5rem',
                backgroundColor: 'white',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: '0.75rem',
                  borderBottom: '2px solid #f3f4f6',
                  paddingBottom: '0.75rem'
                }}>
                  <strong style={{ fontSize: '1.1rem', color: '#1f2937' }}>
                    {formatDate(entry.date)}
                  </strong>
                </div>
                <p style={{ margin: '0.75rem 0', color: '#374151', lineHeight: 1.6 }}>
                  {entry.summary}
                </p>
                {entry.keywords && entry.keywords.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <span style={{ color: '#6b7280', fontSize: '0.85rem', fontWeight: '600' }}>
                      Key indicators:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {entry.keywords.map((kw, i) => (
                        <span key={i} style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.75rem',
                          backgroundColor: '#fef08a',
                          color: '#92400e',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: '500'
                        }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {entry.quotes && entry.quotes.length > 0 && (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f3f4f6' }}>
                    <span style={{ color: '#6b7280', fontSize: '0.85rem', fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
                      📝 Evidence:
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {entry.quotes.map((quote, i) => (
                        <blockquote key={i} style={{
                          margin: '0',
                          paddingLeft: '0.75rem',
                          borderLeft: '3px solid #dc2626',
                          color: '#7f1d1d',
                          fontSize: '0.9rem',
                          fontStyle: 'italic',
                          backgroundColor: '#fef2f2',
                          padding: '0.75rem',
                          borderRadius: '4px'
                        }}>
                          "{quote}"
                        </blockquote>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        backgroundColor: '#fef3c7',
        borderRadius: '8px',
        border: '1px solid #fcd34d',
        fontSize: '0.85rem',
        color: '#78350f'
      }}>
        <strong>🛡️ Privacy & Confidentiality:</strong> All analysis is performed server-side. Chat content is processed only to extract timeline data and is not stored.
      </div>

      <div style={{
        marginTop: '1rem',
        padding: '1rem',
        backgroundColor: '#f0fdf4',
        borderRadius: '8px',
        border: '1px solid #bbf7d0',
        fontSize: '0.85rem',
        color: '#166534'
      }}>
        <strong>⚖️ Legal Disclaimer:</strong> This tool is a documentation aid only. It is not legal advice. Always consult qualified Hong Kong domestic violence services for formal guidance and legal representation.
      </div>
    </section>
  );
}
