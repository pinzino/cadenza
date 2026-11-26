import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { Alert } from '@/lib/app-alert';

export function AuthScreen() {
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 6) {
      Alert.alert('Controlla i dati', 'Inserisci un indirizzo email e una password di almeno 6 caratteri.');
      return;
    }

    setIsLoading(true);
    const credentials = { email: email.trim().toLowerCase(), password };
    const result = isCreatingAccount
      ? await supabase.auth.signUp({ ...credentials, ...(Platform.OS === 'web' && typeof window !== 'undefined' ? { options: { emailRedirectTo: window.location.origin } } : {}) })
      : await supabase.auth.signInWithPassword(credentials);
    setIsLoading(false);

    if (result.error) {
      Alert.alert('Non è stato possibile continuare', result.error.message);
      return;
    }

    if (isCreatingAccount && !result.data.session) {
      Alert.alert('Controlla la tua email', 'Abbiamo inviato un link per confermare il tuo account. Poi torna qui ed effettua l’accesso.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>C</Text></View>
        <Text style={styles.brand}>CADENZA</Text>
        <Text style={styles.title}>{isCreatingAccount ? 'Il tuo tempo, al suo posto.' : 'Bentornato.'}</Text>
        <Text style={styles.subtitle}>
          {isCreatingAccount ? 'Crea un account per ritrovare i task su ogni dispositivo.' : 'Accedi per ritrovare il ritmo della tua giornata.'}
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="nome@esempio.it"
            placeholderTextColor="#99958E"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            autoComplete={isCreatingAccount ? 'new-password' : 'current-password'}
            placeholder="Almeno 6 caratteri"
            placeholderTextColor="#99958E"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            style={styles.input}
          />

          <Pressable disabled={isLoading} onPress={submit} style={({ pressed }) => [styles.primaryButton, (pressed || isLoading) && styles.buttonPressed]}>
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{isCreatingAccount ? 'Crea account' : 'Accedi'}</Text>}
          </Pressable>
        </View>

        <Pressable onPress={() => setIsCreatingAccount((current) => !current)} style={styles.switchButton}>
          <Text style={styles.switchText}>
            {isCreatingAccount ? 'Hai già un account? ' : 'Non hai ancora un account? '}
            <Text style={styles.switchAction}>{isCreatingAccount ? 'Accedi' : 'Crealo ora'}</Text>
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F5F1' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, ...(Platform.OS === 'web' ? { alignSelf: 'center' as const, maxWidth: 404, paddingHorizontal: 0, width: '90%' as const } : {}) },
  brandMark: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#DCEADD', borderRadius: 24, height: 48, justifyContent: 'center', marginBottom: 23, width: 48 },
  brandMarkText: { color: '#426251', fontSize: 22, fontWeight: '700' },
  brand: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 10 },
  title: { color: '#252A26', fontSize: 31, fontWeight: '700', letterSpacing: -1, lineHeight: 38 },
  subtitle: { color: '#74716C', fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 315 },
  form: { marginTop: 39 },
  label: { color: '#6C716B', fontSize: 11, fontWeight: '800', letterSpacing: 1.15, marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 14, borderWidth: 1, color: '#292D29', fontSize: 16, paddingHorizontal: 15, paddingVertical: 15 },
  primaryButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 26, minHeight: 53 },
  buttonPressed: { opacity: 0.76 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  switchButton: { alignSelf: 'center', marginTop: 23, padding: 8 },
  switchText: { color: '#74716C', fontSize: 14 },
  switchAction: { color: '#305D4A', fontWeight: '800' },
});
