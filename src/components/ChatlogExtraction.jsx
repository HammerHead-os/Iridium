import React from 'react';
import WhatsAppTimeline from './WhatsAppTimeline';

export default function ChatlogExtraction({ onBack }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>
      <header style={{
        padding: '1.5rem',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, color: '#1f2937' }}>Chatlog Extraction Tool</h1>
        <button 
          onClick={onBack}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '600'
          }}
        >
          ← Back to Zoya
        </button>
      </header>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <WhatsAppTimeline />
      </div>
    </div>
  );
}
