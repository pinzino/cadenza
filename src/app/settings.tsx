import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatTimeInput, TimeWindow, timeToMinutes } from '@/lib/planner';
import { supabase } from '@/lib/supabase';

const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function shortTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function windowsAreValid(windows: TimeWindow[]) {
  if (!windows.length) return false;
  const sorted = windows.map((window) => ({ ...window, startMinutes: timeToMinutes(window.start), endMinutes: timeToMinutes(window.end) })).sort((first, second) => first.startMinutes - second.startMinutes);
  return sorted.every((window, index) => validTime.test(window.start) && validTime.test(window.end) && window.startMinutes < window.endMinutes && (index === 0 || sorted[index - 1].endMinutes <= window.startMinutes));
}

function suggestWindow(windows: TimeWindow[]) {
  for (let start = 6 * 60; start <= 22 * 60; start += 30) {
    const end = Math.min(start + 120, 23 * 60 + 59);
    const overlaps = windows.some((window) => start < timeToMinutes(window.end) && end > timeToMinutes(window.start));
    if (!overlaps) return { start: shortTime(start), end: shortTime(end) };
  }
  return { start: '21:00', end: '23:00' };
}

export default function SettingsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [workWindows, setWorkWindows] = useState<TimeWindow[]>([{ start: '09:00', end: '18:00' }]);
  const [personalWindows, setPersonalWindows] = useState<TimeWindow[]>([{ start: '18:00', end: '21:00' }]);
  const [maxBlockMinutes, setMaxBlockMinutes] = useState(60);
  const [breakMinutes, setBreakMinutes] = useState(15);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async (currentUserId: string) => {
    setIsLoading(true);
    const { data, error } = await supabase.from('planner_settings').select('day_start, day_end, personal_start, personal_end, work_windows, personal_windows, max_block_minutes, break_minutes').eq('user_id', currentUserId).maybeSingle();
    if (error) {
      setErrorMessage('Completa gli aggiornamenti 002, 003 e 004 in Supabase.');
    } else if (data) {
      const savedWork = data.work_windows as TimeWindow[];
      const savedPersonal = data.personal_windows as TimeWindow[];
      setWorkWindows(savedWork.length ? savedWork : [{ start: data.day_start.slice(0, 5), end: data.day_end.slice(0, 5) }]);
      setPersonalWindows(savedPersonal.length ? savedPersonal : [{ start: data.personal_start.slice(0, 5), end: data.personal_end.slice(0, 5) }]);
      setMaxBlockMinutes(data.max_block_minutes);
      setBreakMinutes(data.break_minutes);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) setUserId(data.session?.user.id ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (userId) void Promise.resolve().then(() => loadSettings(userId));
  }, [loadSettings, userId]);

  function updateWindow(category: 'work' | 'personal', index: number, field: keyof TimeWindow, value: string) {
    const setter = category === 'work' ? setWorkWindows : setPersonalWindows;
    setter((current) => current.map((window, windowIndex) => windowIndex === index ? { ...window, [field]: formatTimeInput(value) } : window));
  }

  function addWindow(category: 'work' | 'personal') {
    const windows = category === 'work' ? workWindows : personalWindows;
    const setter = category === 'work' ? setWorkWindows : setPersonalWindows;
    setter([...windows, suggestWindow(windows)]);
  }

  function removeWindow(category: 'work' | 'personal', index: number) {
    const setter = category === 'work' ? setWorkWindows : setPersonalWindows;
    setter((current) => current.length > 1 ? current.filter((_window, windowIndex) => windowIndex !== index) : current);
  }

  async function saveSettings() {
    if (!userId) return;
    if (!windowsAreValid(workWindows) || !windowsAreValid(personalWindows)) {
      Alert.alert('Fasce non valide', 'Controlla gli orari ed evita sovrapposizioni all’interno della stessa categoria.');
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.from('planner_settings').upsert({
      user_id: userId,
      day_start: `${workWindows[0].start}:00`,
      day_end: `${workWindows[0].end}:00`,
      personal_start: `${personalWindows[0].start}:00`,
      personal_end: `${personalWindows[0].end}:00`,
      work_windows: workWindows,
      personal_windows: personalWindows,
      max_block_minutes: maxBlockMinutes,
      break_minutes: breakMinutes,
      updated_at: new Date().toISOString(),
    });
    setIsSaving(false);

    if (error) {
      Alert.alert('Impostazioni non salvate', 'Controlla gli aggiornamenti Supabase e riprova.');
    } else {
      Alert.alert('Impostazioni salvate', 'Vai su Piano e premi Ricalcola il piano per applicarle.');
    }
  }

  if (!userId) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><Text style={styles.emptyTitle}>Accedi dalla scheda Oggi</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>IMPOSTAZIONI</Text>
        <Text style={styles.title}>Costruisci il tuo ritmo.</Text>
        <Text style={styles.subtitle}>Definisci quando Cadenza può sistemare i tuoi task.</Text>

        {isLoading ? <ActivityIndicator color="#305D4A" style={styles.loader} /> : <View style={styles.settingsCard}>
          <View style={styles.availabilityHeader}><View style={[styles.categoryDot, styles.workDot]} /><Text style={styles.availabilityTitle}>Lavoro</Text></View>
          {workWindows.map((window, index) => <View key={`work-${index}`} style={styles.timeRow}>
            <View style={styles.timeField}><Text style={styles.label}>DALLE</Text><TextInput value={window.start} onChangeText={(value) => updateWindow('work', index, 'start', value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View>
            <Text style={styles.timeSeparator}>—</Text>
            <View style={styles.timeField}><Text style={styles.label}>ALLE</Text><TextInput value={window.end} onChangeText={(value) => updateWindow('work', index, 'end', value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View>
            {workWindows.length > 1 && <Pressable accessibilityLabel="Rimuovi fascia lavoro" onPress={() => removeWindow('work', index)} style={styles.removeWindow}><Text style={styles.removeWindowText}>−</Text></Pressable>}
          </View>)}
          <Pressable onPress={() => addWindow('work')} style={styles.addWindow}><Text style={styles.addWindowText}>+  Aggiungi fascia lavoro</Text></Pressable>

          <View style={styles.divider} />
          <View style={styles.availabilityHeader}><View style={[styles.categoryDot, styles.personalDot]} /><Text style={styles.availabilityTitle}>Personale</Text></View>
          {personalWindows.map((window, index) => <View key={`personal-${index}`} style={styles.timeRow}>
            <View style={styles.timeField}><Text style={styles.label}>DALLE</Text><TextInput value={window.start} onChangeText={(value) => updateWindow('personal', index, 'start', value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View>
            <Text style={styles.timeSeparator}>—</Text>
            <View style={styles.timeField}><Text style={styles.label}>ALLE</Text><TextInput value={window.end} onChangeText={(value) => updateWindow('personal', index, 'end', value)} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View>
            {personalWindows.length > 1 && <Pressable accessibilityLabel="Rimuovi fascia personale" onPress={() => removeWindow('personal', index)} style={styles.removeWindow}><Text style={styles.removeWindowText}>−</Text></Pressable>}
          </View>)}
          <Pressable onPress={() => addWindow('personal')} style={styles.addWindow}><Text style={styles.addWindowText}>+  Aggiungi fascia personale</Text></Pressable>

          <View style={styles.divider} />
          <Text style={styles.label}>DURATA MASSIMA DI UN BLOCCO</Text>
          <View style={styles.options}>{[30, 45, 60, 90].map((minutes) => <Pressable key={minutes} onPress={() => setMaxBlockMinutes(minutes)} style={[styles.option, maxBlockMinutes === minutes && styles.optionSelected]}><Text style={[styles.optionText, maxBlockMinutes === minutes && styles.optionTextSelected]}>{minutes} min</Text></Pressable>)}</View>
          <Text style={styles.label}>PAUSA FRA I BLOCCHI</Text>
          <View style={styles.options}>{[0, 10, 15, 20].map((minutes) => <Pressable key={minutes} onPress={() => setBreakMinutes(minutes)} style={[styles.option, breakMinutes === minutes && styles.optionSelected]}><Text style={[styles.optionText, breakMinutes === minutes && styles.optionTextSelected]}>{minutes ? `${minutes} min` : 'Nessuna'}</Text></Pressable>)}</View>

          <Pressable disabled={isSaving} onPress={() => void saveSettings()} style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.saveButtonPressed]}>{isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>Salva impostazioni</Text>}</Pressable>
        </View>}
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F5F1', flex: 1 }, content: { paddingBottom: 120, paddingHorizontal: 20, paddingTop: 16 }, center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 }, eyebrow: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 8 }, title: { color: '#252A26', fontSize: 30, fontWeight: '700', letterSpacing: -0.9 }, subtitle: { color: '#74716C', fontSize: 15, lineHeight: 21, marginTop: 8 }, loader: { marginTop: 45 }, settingsCard: { backgroundColor: '#FFFFFF', borderColor: '#E8E4DC', borderRadius: 22, borderWidth: 1, marginTop: 25, padding: 18 }, availabilityHeader: { alignItems: 'center', flexDirection: 'row', marginBottom: 2 }, availabilityTitle: { color: '#414641', fontSize: 16, fontWeight: '800' }, categoryDot: { borderRadius: 5, height: 10, marginRight: 8, width: 10 }, workDot: { backgroundColor: '#5577B8' }, personalDot: { backgroundColor: '#D28757' }, timeRow: { alignItems: 'flex-end', flexDirection: 'row', marginBottom: 8 }, timeField: { flex: 1 }, timeSeparator: { color: '#9C978F', fontSize: 20, paddingBottom: 12, paddingHorizontal: 9 }, label: { color: '#77736C', fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginBottom: 7, marginTop: 12 }, timeInput: { backgroundColor: '#F8F7F3', borderColor: '#DEDAD2', borderRadius: 12, borderWidth: 1, color: '#2B302C', fontSize: 20, fontWeight: '700', padding: 12, textAlign: 'center' }, removeWindow: { alignItems: 'center', backgroundColor: '#FBE7E4', borderRadius: 10, height: 45, justifyContent: 'center', marginLeft: 8, width: 34 }, removeWindowText: { color: '#B1433C', fontSize: 22, fontWeight: '700' }, addWindow: { alignSelf: 'flex-start', marginTop: 3, paddingVertical: 7 }, addWindowText: { color: '#3F725B', fontSize: 12, fontWeight: '800' }, divider: { backgroundColor: '#EBE7E0', height: 1, marginVertical: 19 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, option: { backgroundColor: '#F8F7F3', borderColor: '#E0DCD5', borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, optionSelected: { backgroundColor: '#E4F0E5', borderColor: '#3F725B' }, optionText: { color: '#716D66', fontSize: 12, fontWeight: '700' }, optionTextSelected: { color: '#315D4A' }, saveButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 25, minHeight: 53 }, saveButtonPressed: { opacity: 0.72 }, saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, errorText: { backgroundColor: '#FFF1E8', borderRadius: 12, color: '#9F3800', fontSize: 13, lineHeight: 19, marginTop: 15, padding: 12 }, emptyTitle: { color: '#363A36', fontSize: 17, fontWeight: '800', textAlign: 'center' },
});
