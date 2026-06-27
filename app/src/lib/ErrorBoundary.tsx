import { Component, type ReactNode, type ErrorInfo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WildClaude] Unhandled render error:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View className="flex-1 bg-bg items-center justify-center px-6">
        <Text className="text-5xl mb-4">🐺</Text>
        <Text className="text-white text-xl font-bold mb-2">Qualcosa è andato storto</Text>
        <ScrollView className="max-h-48 w-full bg-surface border border-border rounded-xl p-3 mb-6">
          <Text className="text-red-400 text-xs font-mono">{error.message}</Text>
        </ScrollView>
        <Pressable
          onPress={this.reset}
          className="bg-accent px-6 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold">Riprova</Text>
        </Pressable>
      </View>
    );
  }
}
