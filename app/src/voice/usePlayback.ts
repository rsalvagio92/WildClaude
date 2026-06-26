import { useEffect, useState } from 'react';
import { getPlaybackState, subscribePlayback, type PlaybackState } from './tts';

export function usePlayback() {
  const [state, setState] = useState<PlaybackState>(getPlaybackState());

  useEffect(() => {
    return subscribePlayback(setState);
  }, []);

  return state;
}
