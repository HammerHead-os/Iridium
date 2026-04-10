import React, { useState } from 'react';
import ZenPlantDecoy from './components/ZenPlantDecoy';
import PathfinderDashboard from './components/PathfinderDashboard';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';

function App() {
  const [unlocked, setUnlocked] = useState(false);

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
      ) : (
        <PathfinderDashboard />
      )}
    </>
  );
}

export default App;
