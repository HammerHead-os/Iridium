import React, { useState } from 'react';
import ZenPlantDecoy from './components/ZenPlantDecoy';
import PathfinderDashboard from './components/PathfinderDashboard';
import ChatlogExtraction from './components/ChatlogExtraction';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState('main'); // 'main' or 'chatlog-extraction'

  useInactivityTimeout(60000, () => {
    if (unlocked) {
      setUnlocked(false);
      window.location.reload(); 
    }
  });

  return (
    <>
      {!unlocked ? (
        <ZenPlantDecoy onUnlock={() => setUnlocked(true)} />
      ) : page === 'chatlog-extraction' ? (
        <ChatlogExtraction onBack={() => setPage('main')} />
      ) : (
        <PathfinderDashboard onOpenChatlogExtraction={() => setPage('chatlog-extraction')} />
      )}
    </>
  );
}

export default App;
