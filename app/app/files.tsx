import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  size?: number;
  modified?: number;
}

function FileRow({ file, onSelect }: { file: FileEntry; onSelect: () => void }) {
  const icon = file.type === 'folder' ? '📁' : '📄';
  const size = file.size ? `${Math.round(file.size / 1024)}KB` : '';

  return (
    <Pressable onPress={onSelect} className="flex-row items-center gap-3 px-4 py-3 border-b border-border/40">
      <Text className="text-2xl">{icon}</Text>
      <View className="flex-1">
        <Text className="text-white font-medium">{file.name}</Text>
        {size && <Text className="text-muted text-xs">{size}</Text>}
      </View>
      <Text className="text-muted text-lg">›</Text>
    </Pressable>
  );
}

export default function FilesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'home' | 'projects' | 'system'>('home');
  const [isLoading] = useState(false);

  // Mock data for demo
  const mockFiles: Record<string, FileEntry[]> = {
    home: [
      { name: '.wild-claude-pi', type: 'folder' },
      { name: 'wildnomads', type: 'folder' },
      { name: 'WildClaude', type: 'folder' },
    ],
    projects: [
      { name: 'WildClaude', type: 'folder' },
      { name: 'WildNomads', type: 'folder' },
    ],
    system: [
      { name: 'tmp', type: 'folder' },
      { name: 'home', type: 'folder' },
      { name: 'var', type: 'folder' },
    ],
  };

  const files = mockFiles[tab] || [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base">📁 Files</Text>
      </View>

      <View className="flex-row border-b border-border">
        {(['home', 'projects', 'system'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 border-b-2 ${t === tab ? 'border-accent' : 'border-transparent'}`}
          >
            <Text className={t === tab ? 'text-white font-semibold text-center text-sm' : 'text-muted text-center text-sm capitalize'}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#888" />
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(f) => f.name}
          renderItem={({ item }) => (
            <FileRow
              file={item}
              onSelect={() => {
                // On mobile, deep inspection is limited; just show preview
                // Real impl would open preview modal or file detail
              }}
            />
          )}
          ListEmptyComponent={<Text className="text-muted text-center mt-20">No files.</Text>}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}
