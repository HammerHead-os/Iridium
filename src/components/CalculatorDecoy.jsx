import React, { useState } from 'react';

export default function CalculatorDecoy({ onUnlock }) {
  const [display, setDisplay] = useState('');
  
  const handlePress = (val) => {
    if (val === 'C') {
      setDisplay('');
      return;
    }
    
    if (val === '=') {
      if (display === '1234') {
        onUnlock();
      } else {
        try {
          setDisplay(eval(display).toString());
        } catch {
          setDisplay('Error');
        }
      }
      return;
    }
    
    setDisplay(prev => prev + val);
  };

  const buttons = [
    '7', '8', '9', '/',
    '4', '5', '6', '*',
    '1', '2', '3', '-',
    'C', '0', '=', '+'
  ];

  return (
    <div className="calculator-container">
      <div className="calculator">
        <div className="calc-display">{display || '0'}</div>
        <div className="calc-grid">
          {buttons.map(btn => (
            <button key={btn} className="calc-btn" onClick={() => handlePress(btn)}>
              {btn}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
