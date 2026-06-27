import { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import { useServers } from '@/store/servers';

export function OfflineBanner() {
  const info = useServers((s) => s.info);
  const active = useServers((s) => s.active());

  // Show banner when: server is paired but probing returned online=false.
  const offline = !!active && info !== null && info.online === false;

  const slideAnim = useRef(new Animated.Value(offline ? 0 : -48)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: offline ? 0 : -48,
      useNativeDriver: true,
      speed: 20,
      bounciness: 0,
    }).start();
  }, [offline]);

  return (
    <Animated.View
      style={{ transform: [{ translateY: slideAnim }] }}
      className="absolute top-0 left-0 right-0 z-50 bg-red-600/90 px-4 py-2 flex-row items-center justify-center"
      pointerEvents="none"
    >
      <Text className="text-white text-xs font-medium">
        ⚠️  Server non raggiungibile — dati in cache
      </Text>
    </Animated.View>
  );
}
