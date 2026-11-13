import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PwaReloadPrompt } from '@/components/ui/pwa-reload-prompt';
import { logger } from '@/logger';

function App() {
  const [count, setCount] = useState(0);
  logger.debug('App component rendered', {
    count,
  });

  const handleButtonClick = () => {
    setCount((prevCount) => prevCount + 1);
    logger.info('Button clicked', {
      newCount: count + 1,
    });
  };

  return (
    <>
      <div className='min-h-screen p-8'>
        <h1 className='text-2xl font-bold'>Ready for FoodApp PWA</h1>
        <button
          type='button'
          onClick={handleButtonClick}
          className='cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-blue-700 active:scale-95'>
          Count is {count}
        </button>
        <Button onPress={handleButtonClick}>Count is {count}</Button>
      </div>
      <PwaReloadPrompt />
    </>
  );
}

export default App;
