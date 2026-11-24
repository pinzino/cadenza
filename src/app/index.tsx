import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { AuthScreen } from '@/components/auth-screen';
import { formatTimeInput, timeToMinutes } from '@/lib/planner';
import { supabase } from '@/lib/supabase';

type Priority = 'Alta' | 'Media' | 'Bassa';
type Category = 'Lavoro' | 'Personale';
type VoiceStep = 'title' | 'category' | 'priority' | 'duration' | 'dueDate' | 'save';

type Task = {
  id: string;
  title: string;
  category: Category;
  duration_minutes: number;
  priority: Priority;
  scheduled_date: string | null;
  scheduled_time: string | null;
  scheduled_window_start: string | null;
  scheduled_window_end: string | null;
  is_complete: boolean;
  is_splittable: boolean;
  reminder_enabled: boolean;
  reminder_minutes: number;
};

const priorityColors: Record<Priority, { text: string; background: string }> = {
  Alta: { text: '#B54708', background: '#FFF1E8' },
  Media: { text: '#7A5A00', background: '#FFF7D6' },
  Bassa: { text: '#37705B', background: '#EAF7F0' },
};

const voiceStepPrompts: Record<VoiceStep, string> = {
  title: 'Dimmi il titolo del task.',
  category: 'È un task di lavoro o personale?',
  priority: 'Qual è la priorità: alta, media o bassa?',
  duration: 'Quanto tempo serve? Per esempio: 30 minuti oppure un’ora.',
  dueDate: 'Quando vuoi farlo? Puoi dire oggi, domani, un giorno della settimana, oppure senza data.',
  save: 'Se va bene, di’ “salva”. Oppure tocca un campo per modificarlo.',
};

const todayLabel = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})
  .format(new Date())
  .replace(/^./, (letter) => letter.toUpperCase());

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const remainingAfterDays = minutes % 1440;
  const hours = Math.floor(remainingAfterDays / 60);
  const remainingMinutes = remainingAfterDays % 60;
  const parts = [days ? `${days} ${days === 1 ? 'giorno' : 'giorni'}` : '', hours ? `${hours} h` : '', remainingMinutes ? `${remainingMinutes} min` : ''].filter(Boolean);
  return parts.join(' ') || '0 min';
}

function parseDurationPart(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatScheduledDate(value: string | null) {
  if (!value) return null;
  const today = toDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === today) return 'Oggi';
  if (value === toDateKey(tomorrow)) return 'Domani';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatCalendarMonth(date: Date) {
  return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
    .format(date)
    .replace(/^./, (letter) => letter.toUpperCase());
}

function getCalendarDays(cursor: Date) {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const numberOfDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((leadingEmptyDays + numberOfDays) / 7) * 7;

  return Array.from({ length: cells }, (_, index) => {
    const day = index - leadingEmptyDays + 1;
    return day > 0 && day <= numberOfDays ? new Date(cursor.getFullYear(), cursor.getMonth(), day) : null;
  });
}

function toStoredTime(value: string) {
  const time = value.trim();
  if (!time) return null;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  return match ? `${time}:00` : undefined;
}

type VoiceTaskDetails = {
  title: string;
  category?: Category;
  priority?: Priority;
  durationMinutes?: number;
  date?: string | null;
  time?: string;
  reminderMinutes?: number;
};

function dateForWeekday(today: Date, weekday: number, forceNextWeek: boolean) {
  const offset = (weekday - today.getDay() + 7) % 7;
  const daysToAdd = forceNextWeek && offset === 0 ? 7 : offset;
  const result = new Date(today);
  result.setDate(result.getDate() + daysToAdd);
  return toDateKey(result);
}

function parseVoiceTask(transcript: string): VoiceTaskDetails {
  const today = new Date();
  const lower = transcript.toLocaleLowerCase('it-IT');
  const details: VoiceTaskDetails = { title: transcript.trim() };
  let cleanTitle = transcript;
  const remove = (expression: RegExp) => {
    cleanTitle = cleanTitle.replace(expression, ' ');
  };

  if (/\b(?:senza data|note sparse|nel mucchio)\b/i.test(lower)) {
    details.date = null;
    remove(/\b(?:senza data|note sparse|nel mucchio)\b/gi);
  } else if (/\bdopodomani\b/i.test(lower)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    details.date = toDateKey(date);
    remove(/\bdopodomani\b/gi);
  } else if (/\bdomani\b/i.test(lower)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    details.date = toDateKey(date);
    remove(/\bdomani\b/gi);
  } else if (/\boggi\b/i.test(lower)) {
    details.date = toDateKey(today);
    remove(/\boggi\b/gi);
  }

  const weekdays: [RegExp, number][] = [
    [/\b(?:domenica)\b/i, 0], [/\b(?:lunedì|lunedi)\b/i, 1], [/\bmartedì\b/i, 2],
    [/\bmercoledì\b/i, 3], [/\bgiovedì\b/i, 4], [/\bvenerdì\b/i, 5], [/\bsabato\b/i, 6],
  ];
  const spokenWeekday = weekdays.find(([expression]) => expression.test(lower));
  if (spokenWeekday) {
    const nextWeek = /\bprossim[oa]\b/i.test(lower);
    details.date = dateForWeekday(today, spokenWeekday[1], nextWeek);
    remove(/\b(?:il )?(?:prossim[oa] )?(?:domenica|lunedì|lunedi|martedì|mercoledì|giovedì|venerdì|sabato)\b/gi);
  }

  const timeMatch = lower.match(/\b(?:alle?|ore)\s+([01]?\d|2[0-3])(?:\s*(?:[:.]|e)\s*([0-5]?\d))?\b/i);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
    details.time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    remove(/\b(?:alle?|ore)\s+(?:[01]?\d|2[0-3])(?:\s*(?:[:.]|e)\s*[0-5]?\d)?\b/gi);
  }

  const hourDuration = lower.match(/\b(?:per|durata(?: di)?|da)\s+(\d+)\s*(?:ore?|h)(?:\s*(?:e)?\s*(\d+)\s*(?:minuti|min|m))?\b/i);
  const oneHourDuration = lower.match(/\b(?:per|durata(?: di)?|da)\s+un'?\s*ora(?:\s*(?:e)?\s*(\d+)\s*(?:minuti|min|m))?\b/i);
  const minuteDuration = lower.match(/\b(?:per|durata(?: di)?|da)\s+(\d+)\s*(?:minuti|min|m)\b/i);
  if (hourDuration) {
    details.durationMinutes = Number(hourDuration[1]) * 60 + Number(hourDuration[2] ?? 0);
    remove(/\b(?:per|durata(?: di)?|da)\s+\d+\s*(?:ore?|h)(?:\s*(?:e)?\s*\d+\s*(?:minuti|min|m))?\b/gi);
  } else if (oneHourDuration) {
    details.durationMinutes = 60 + Number(oneHourDuration[1] ?? 0);
    remove(/\b(?:per|durata(?: di)?|da)\s+un'?\s*ora(?:\s*(?:e)?\s*\d+\s*(?:minuti|min|m))?\b/gi);
  } else if (minuteDuration) {
    details.durationMinutes = Number(minuteDuration[1]);
    remove(/\b(?:per|durata(?: di)?|da)\s+\d+\s*(?:minuti|min|m)\b/gi);
  }

  if (/\b(?:lavoro|lavorativ[oa])\b/i.test(lower)) {
    details.category = 'Lavoro';
    remove(/\b(?:categoria )?(?:lavoro|lavorativ[oa])\b/gi);
  } else if (/\bpersonale\b/i.test(lower)) {
    details.category = 'Personale';
    remove(/\b(?:categoria )?personale\b/gi);
  }

  const priorityMatch = lower.match(/\bpriorit(?:à|a)[\s,:-]*(?:è\s*)?(alta|media|bassa)\b/i);
  if (priorityMatch) {
    details.priority = `${priorityMatch[1][0].toUpperCase()}${priorityMatch[1].slice(1).toLowerCase()}` as Priority;
    remove(/\bpriorit(?:à|a)[\s,:-]*(?:è\s*)?(?:alta|media|bassa)\b/gi);
  } else if (/\burgente\b/i.test(lower)) {
    details.priority = 'Alta';
    remove(/\burgente\b/gi);
  }

  const reminderMatch = lower.match(/\b(?:ricordamelo|promemoria)\s+(\d+)\s*(?:minuti|min)\s+prima\b/i);
  if (reminderMatch) {
    details.reminderMinutes = Number(reminderMatch[1]);
    remove(/\b(?:ricordamelo|promemoria)\s+\d+\s*(?:minuti|min)\s+prima\b/gi);
  }

  const candidateTitle = cleanTitle
    .replace(/[,:;]+/g, ' ')
    .replace(/\b(?:e|per|il|alle?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  details.title = candidateTitle.length >= 2 ? candidateTitle : transcript.trim();
  return details;
}

function SwipeableTask({ task, onToggle, onEdit, onDelete }: { task: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const [translateX] = useState(() => new Animated.Value(0));
  const [openSide, setOpenSide] = useState<'edit' | 'delete' | null>(null);

  const moveTask = useCallback((side: 'edit' | 'delete' | null) => {
    const toValue = side === 'edit' ? -104 : side === 'delete' ? 104 : 0;
    Animated.spring(translateX, { toValue, useNativeDriver: true, bounciness: 0 }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        const startOffset = openSide === 'edit' ? -104 : openSide === 'delete' ? 104 : 0;
        translateX.setValue(Math.max(-104, Math.min(104, startOffset + gesture.dx)));
      },
      onPanResponderRelease: (_event, gesture) => {
        const startOffset = openSide === 'edit' ? -104 : openSide === 'delete' ? 104 : 0;
        const endOffset = startOffset + gesture.dx;
        const nextOpenSide = endOffset < -38 ? 'edit' : endOffset > 38 ? 'delete' : null;
        setOpenSide(nextOpenSide);
        moveTask(nextOpenSide);
      },
      onPanResponderTerminate: () => moveTask(openSide),
    }),
    [moveTask, openSide, translateX],
  );

  const priority = priorityColors[task.priority];
  const scheduledDate = formatScheduledDate(task.scheduled_date);

  function editTask() {
    setOpenSide(null);
    moveTask(null);
    onEdit();
  }

  function deleteTask() {
    setOpenSide(null);
    moveTask(null);
    onDelete();
  }

  return (
    <View style={styles.taskWrapper}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Elimina ${task.title}`} onPress={deleteTask} style={styles.deleteAction}>
        <Text style={styles.deleteActionText}>Elimina</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Modifica ${task.title}`} onPress={editTask} style={styles.editAction}>
        <Text style={styles.editActionText}>Modifica</Text>
      </Pressable>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Segna ${task.title} come ${task.is_complete ? 'da fare' : 'completato'}`} onPress={onToggle} style={[styles.taskCard, task.category === 'Lavoro' ? styles.workTaskCard : styles.personalTaskCard]}>
          <View style={[styles.check, task.is_complete && styles.checkDone]}>{task.is_complete && <Text style={styles.checkMark}>✓</Text>}</View>
          <View style={styles.taskContent}>
            <Text style={[styles.taskTitle, task.is_complete && styles.taskTitleDone]}>{task.title}</Text>
            <View style={styles.taskMeta}>
              {task.scheduled_time && <><Text style={styles.taskTime}>{task.scheduled_time.slice(0, 5)}</Text><Text style={styles.metaDot}>•</Text></>}
              <Text style={styles.taskMetaText}>{formatDuration(task.duration_minutes)}</Text>
              <Text style={styles.metaDot}>•</Text>
              <Text style={[styles.taskMetaText, task.category === 'Lavoro' ? styles.workTaskCategory : styles.personalTaskCategory]}>{task.category}</Text>
              {scheduledDate && <><Text style={styles.metaDot}>•</Text><Text style={styles.taskMetaText}>{scheduledDate}</Text></>}
            </View>
          </View>
          <View style={[styles.priorityPill, { backgroundColor: priority.background }]}><Text style={[styles.priorityText, { color: priority.text }]}>{task.priority}</Text></View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<Category>('Personale');
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>('Media');
  const [newTaskDuration, setNewTaskDuration] = useState(30);
  const [newTaskSplittable, setNewTaskSplittable] = useState(true);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customDays, setCustomDays] = useState('0');
  const [customHours, setCustomHours] = useState('1');
  const [customMinutes, setCustomMinutes] = useState('0');
  const [newTaskDate, setNewTaskDate] = useState<string | null>(toDateKey(new Date()));
  const [newTaskTime, setNewTaskTime] = useState('');
  const [newTaskWindowStart, setNewTaskWindowStart] = useState('');
  const [newTaskWindowEnd, setNewTaskWindowEnd] = useState('');
  const [newTaskReminderEnabled, setNewTaskReminderEnabled] = useState(true);
  const [newTaskReminderMinutes, setNewTaskReminderMinutes] = useState(10);
  const [defaultReminderEnabled, setDefaultReminderEnabled] = useState(true);
  const [defaultReminderMinutes, setDefaultReminderMinutes] = useState(10);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(new Date());
  const [isSaving, setIsSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSummary, setVoiceSummary] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceStep, setVoiceStep] = useState<VoiceStep | null>(null);
  const voiceStepRef = useRef<VoiceStep | null>(null);
  const pendingVoiceStepRef = useRef<VoiceStep | null>(null);
  const composerScrollRef = useRef<ScrollViewInstance>(null);
  const voiceStepPositions = useRef<Partial<Record<VoiceStep, number>>>({});
  const voiceSaveActionRef = useRef<(() => void) | null>(null);

  function setActiveVoiceStep(step: VoiceStep | null) {
    voiceStepRef.current = step;
    setVoiceStep(step);
  }

  function rememberVoiceStepPosition(step: VoiceStep, position: number) {
    voiceStepPositions.current[step] = position;
  }

  function interruptVoiceGuide() {
    const wasRunning = isListening || voiceStepRef.current !== null;
    pendingVoiceStepRef.current = null;
    setActiveVoiceStep(null);
    if (isListening) ExpoSpeechRecognitionModule.stop();
    if (wasRunning) setVoiceSummary('Guida vocale interrotta: puoi modificare il task manualmente.');
  }

  function setVoiceDuration(minutes: number) {
    if ([15, 30, 45, 60].includes(minutes)) {
      setNewTaskDuration(minutes);
      setIsCustomDuration(false);
      return;
    }
    const days = Math.floor(minutes / 1440);
    const remainingMinutes = minutes % 1440;
    setCustomDays(String(days));
    setCustomHours(String(Math.floor(remainingMinutes / 60)));
    setCustomMinutes(String(remainingMinutes % 60));
    setIsCustomDuration(true);
  }

  function acceptVoiceStep(transcript: string) {
    const currentStep = voiceStepRef.current;
    if (!currentStep) return;
    const details = parseVoiceTask(currentStep === 'duration' ? `durata ${transcript}` : currentStep === 'priority' ? `priorità ${transcript}` : currentStep === 'category' ? `categoria ${transcript}` : transcript);
    let accepted = false;
    let nextStep: VoiceStep | null = null;
    let recognizedLabel = '';

    if (currentStep === 'title' && transcript.trim().length >= 2) {
      setNewTaskTitle(transcript.trim());
      accepted = true;
      nextStep = 'category';
      recognizedLabel = `Titolo: ${transcript.trim()}`;
    } else if (currentStep === 'category' && details.category) {
      setNewTaskCategory(details.category);
      accepted = true;
      nextStep = 'priority';
      recognizedLabel = `Categoria: ${details.category}`;
    } else if (currentStep === 'priority' && details.priority) {
      setNewTaskPriority(details.priority);
      accepted = true;
      nextStep = 'duration';
      recognizedLabel = `Priorità: ${details.priority}`;
    } else if (currentStep === 'duration' && details.durationMinutes && details.durationMinutes > 0) {
      setVoiceDuration(details.durationMinutes);
      accepted = true;
      nextStep = 'dueDate';
      recognizedLabel = `Durata: ${formatDuration(details.durationMinutes)}`;
    } else if (currentStep === 'dueDate' && details.date !== undefined) {
      setNewTaskDate(details.date);
      if (!details.date) setNewTaskTime('');
      accepted = true;
      nextStep = 'save';
      recognizedLabel = details.date ? `Scadenza: ${formatScheduledDate(details.date)}` : 'Senza data';
    } else if (currentStep === 'save' && /\b(?:salva|conferma)\b/i.test(transcript)) {
      accepted = true;
      recognizedLabel = 'Salvataggio in corso';
    }

    if (!accepted) {
      setVoiceSummary(`Non ho capito. ${voiceStepPrompts[currentStep]}`);
      return;
    }

    if (currentStep === 'save') {
      pendingVoiceStepRef.current = null;
      setActiveVoiceStep(null);
      setVoiceSummary(`${recognizedLabel}.`);
      voiceSaveActionRef.current?.();
    } else if (nextStep) {
      pendingVoiceStepRef.current = nextStep;
      setActiveVoiceStep(nextStep);
      setVoiceSummary(`${recognizedLabel}. ${voiceStepPrompts[nextStep]}`);
    } else {
      setActiveVoiceStep(null);
      setVoiceSummary(`${recognizedLabel}. Compilazione vocale completata.`);
    }
  }

  async function startVoiceStep(step: VoiceStep) {
    try {
      setVoiceTranscript(null);
      setActiveVoiceStep(step);
      setVoiceSummary(voiceStepPrompts[step]);

      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('Dettatura non disponibile', 'Il riconoscimento vocale non è disponibile su questo dispositivo.');
        return;
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microfono non autorizzato', 'Per inserire un task a voce, consenti l’uso del microfono nelle impostazioni del telefono.');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'it-IT',
        interimResults: true,
        continuous: false,
        iosTaskHint: 'dictation',
      });
    } catch {
      setIsListening(false);
      Alert.alert('Dettatura non disponibile', 'Per usare il microfono serve la versione di sviluppo di Cadenza, non Expo Go.');
    }
  }

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    const nextStep = pendingVoiceStepRef.current;
    if (nextStep) {
      pendingVoiceStepRef.current = null;
      void startVoiceStep(nextStep);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) return;
    setVoiceTranscript(transcript);
    if (event.isFinal) acceptVoiceStep(transcript);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false);
    if (event.error !== 'aborted') {
      setVoiceSummary(event.message || 'Non ho capito la risposta. Tocca il microfono e riprova.');
    }
  });

  useEffect(() => {
    if (!voiceStep) return;
    const scrollY = voiceStepPositions.current[voiceStep];
    if (scrollY === undefined) return;
    const scrollTimer = setTimeout(() => composerScrollRef.current?.scrollTo({ y: Math.max(0, scrollY - 64), animated: true }), 80);
    return () => clearTimeout(scrollTimer);
  }, [voiceStep]);

  const quickDateOptions = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return [
      { label: 'Oggi', value: toDateKey(today) },
      { label: 'Domani', value: toDateKey(tomorrow) },
      { label: 'Senza data', value: null },
    ];
  }, []);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (isMounted) {
        setSession(currentSession);
        setIsCheckingSession(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const loadTasks = useCallback(async () => {
    if (!session) return;
    setIsLoadingTasks(true);
    setErrorMessage(null);
    const [tasksResult, settingsResult] = await Promise.all([
      supabase.from('tasks').select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, reminder_enabled, reminder_minutes').order('scheduled_date', { ascending: true, nullsFirst: false }).order('scheduled_time', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }),
      supabase.from('planner_settings').select('reminder_default_enabled, reminder_default_minutes').eq('user_id', session.user.id).maybeSingle(),
    ]);
    const { data, error } = tasksResult;

    if (error) {
      setErrorMessage('Non riesco ancora a leggere i task. Esegui lo script schema.sql in Supabase.');
    } else {
      setTasks(data as Task[]);
      if (settingsResult.data) {
        setDefaultReminderEnabled(settingsResult.data.reminder_default_enabled);
        setDefaultReminderMinutes(settingsResult.data.reminder_default_minutes);
      }
    }
    setIsLoadingTasks(false);
  }, [session]);

  useFocusEffect(useCallback(() => {
    if (session) void loadTasks();
  }, [loadTasks, session]));

  const plannedMinutes = useMemo(
    () => tasks.filter((task) => !task.is_complete && task.scheduled_date).reduce((total, task) => total + task.duration_minutes, 0),
    [tasks],
  );
  const plannedTasks = useMemo(() => tasks.filter((task) => task.scheduled_date), [tasks]);
  const backlogTasks = useMemo(() => tasks.filter((task) => !task.scheduled_date), [tasks]);

  async function addTask() {
    const title = newTaskTitle.trim();
    if (!title || !session) return;

    const durationMinutes = isCustomDuration
      ? parseDurationPart(customDays) * 1440 + parseDurationPart(customHours) * 60 + parseDurationPart(customMinutes)
      : newTaskDuration;

    if (durationMinutes < 1) {
      Alert.alert('Durata mancante', 'Inserisci almeno un minuto di durata.');
      return;
    }

    const scheduledTime = toStoredTime(newTaskTime);
    const scheduledWindowStart = toStoredTime(newTaskWindowStart);
    const scheduledWindowEnd = toStoredTime(newTaskWindowEnd);
    if (scheduledTime === undefined) {
      Alert.alert('Orario non valido', 'Usa il formato HH:MM, per esempio 09:30.');
      return;
    }
    if (scheduledWindowStart === undefined || scheduledWindowEnd === undefined || Boolean(scheduledWindowStart) !== Boolean(scheduledWindowEnd)) {
      Alert.alert('Fascia oraria non valida', 'Inserisci sia l’inizio sia la fine, nel formato HH:MM.');
      return;
    }
    if (scheduledTime && !newTaskDate) {
      Alert.alert('Scegli un giorno', 'Un task senza data non può avere un orario.');
      return;
    }
    if (scheduledWindowStart && (!newTaskDate || timeToMinutes(scheduledWindowStart) >= timeToMinutes(scheduledWindowEnd!))) {
      Alert.alert('Fascia oraria non valida', !newTaskDate ? 'Una fascia oraria richiede anche un giorno.' : 'La fine della fascia deve essere dopo l’inizio.');
      return;
    }
    if (scheduledTime && scheduledWindowStart && (timeToMinutes(scheduledTime) < timeToMinutes(scheduledWindowStart) || timeToMinutes(scheduledTime) + durationMinutes > timeToMinutes(scheduledWindowEnd!))) {
      Alert.alert('Orario fuori fascia', 'L’orario e la durata del task devono rientrare nella fascia scelta.');
      return;
    }

    setIsSaving(true);
    const taskValues = {
      title,
      category: newTaskCategory,
      duration_minutes: durationMinutes,
      priority: newTaskPriority,
      scheduled_date: newTaskDate,
      scheduled_time: scheduledTime,
      scheduled_window_start: scheduledWindowStart,
      scheduled_window_end: scheduledWindowEnd,
      is_splittable: newTaskSplittable,
      reminder_enabled: newTaskReminderEnabled,
      reminder_minutes: newTaskReminderMinutes,
      is_unscheduled: false,
      planning_note: null,
    };
    const result = editingTask
      ? await supabase.from('tasks').update(taskValues).eq('id', editingTask.id)
        .select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, reminder_enabled, reminder_minutes').single()
      : await supabase.from('tasks').insert({ user_id: session.user.id, ...taskValues })
        .select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, scheduled_window_start, scheduled_window_end, is_complete, is_splittable, reminder_enabled, reminder_minutes').single();
    const { data, error } = result;
    setIsSaving(false);

    if (error) {
      Alert.alert('Task non salvato', 'Controlla di aver eseguito lo script schema.sql nel SQL Editor di Supabase.');
      return;
    }

    if (editingTask) await supabase.from('task_blocks').delete().eq('task_id', editingTask.id);
    setTasks((currentTasks) => editingTask
      ? currentTasks.map((task) => (task.id === editingTask.id ? data as Task : task))
      : [...currentTasks, data as Task]);
    closeComposer();
  }

  useEffect(() => {
    voiceSaveActionRef.current = () => { void addTask(); };
  });

  function openComposer() {
    setEditingTask(null);
    setNewTaskTitle('');
    setNewTaskCategory('Personale');
    setNewTaskPriority('Media');
    setNewTaskDuration(30);
    setNewTaskSplittable(true);
    setIsCustomDuration(false);
    setCustomDays('0');
    setCustomHours('1');
    setCustomMinutes('0');
    setNewTaskDate(toDateKey(new Date()));
    setNewTaskTime('');
    setNewTaskWindowStart('');
    setNewTaskWindowEnd('');
    setNewTaskReminderEnabled(defaultReminderEnabled);
    setNewTaskReminderMinutes(defaultReminderMinutes);
    setVoiceSummary(null);
    setVoiceTranscript(null);
    setActiveVoiceStep(null);
    pendingVoiceStepRef.current = null;
    setIsComposerOpen(true);
  }

  function openEditTask(task: Task) {
    setEditingTask(task);
    setNewTaskTitle(task.title);
    setNewTaskCategory(task.category);
    setNewTaskPriority(task.priority);
    setNewTaskDate(task.scheduled_date);
    setNewTaskTime(task.scheduled_time?.slice(0, 5) ?? '');
    setNewTaskWindowStart(task.scheduled_window_start?.slice(0, 5) ?? '');
    setNewTaskWindowEnd(task.scheduled_window_end?.slice(0, 5) ?? '');
    setNewTaskReminderEnabled(task.reminder_enabled);
    setNewTaskReminderMinutes(task.reminder_minutes);
    setVoiceSummary(null);
    setVoiceTranscript(null);
    setActiveVoiceStep(null);
    pendingVoiceStepRef.current = null;
    setNewTaskSplittable(task.is_splittable);

    if ([15, 30, 45, 60].includes(task.duration_minutes)) {
      setNewTaskDuration(task.duration_minutes);
      setIsCustomDuration(false);
    } else {
      const days = Math.floor(task.duration_minutes / 1440);
      const remainingAfterDays = task.duration_minutes % 1440;
      setCustomDays(String(days));
      setCustomHours(String(Math.floor(remainingAfterDays / 60)));
      setCustomMinutes(String(remainingAfterDays % 60));
      setIsCustomDuration(true);
    }
    setIsComposerOpen(true);
  }

  function openCalendar() {
    setCalendarCursor(newTaskDate ? dateFromKey(newTaskDate) : new Date());
    setIsCalendarOpen(true);
  }

  function chooseDate(date: Date) {
    setNewTaskDate(toDateKey(date));
    setIsCalendarOpen(false);
  }

  function moveCalendarMonth(offset: number) {
    setCalendarCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function closeComposer() {
    if (isSaving) return;
    if (isListening) ExpoSpeechRecognitionModule.stop();
    setActiveVoiceStep(null);
    pendingVoiceStepRef.current = null;
    setIsComposerOpen(false);
    setEditingTask(null);
  }

  function toggleVoiceInput() {
    if (isListening) {
      pendingVoiceStepRef.current = null;
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    void startVoiceStep(voiceStepRef.current ?? 'title');
  }

  async function toggleTask(task: Task) {
    const nextCompletedValue = !task.is_complete;
    setTasks((currentTasks) => currentTasks.map((item) => (item.id === task.id ? { ...item, is_complete: nextCompletedValue } : item)));

    const { error } = await supabase.from('tasks').update({ is_complete: nextCompletedValue }).eq('id', task.id);
    if (error) {
      setTasks((currentTasks) => currentTasks.map((item) => (item.id === task.id ? task : item)));
      Alert.alert('Aggiornamento non riuscito', 'Riprova tra poco.');
    } else if (nextCompletedValue) {
      await supabase.from('task_blocks').delete().eq('task_id', task.id);
    }
  }

  async function deleteTask(task: Task) {
    const previousTasks = tasks;
    setTasks((currentTasks) => currentTasks.filter((item) => item.id !== task.id));

    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      setTasks(previousTasks);
      Alert.alert('Eliminazione non riuscita', 'Riprova tra poco.');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (isCheckingSession) {
    return <View style={styles.loadingScreen}><ActivityIndicator color="#305D4A" size="large" /></View>;
  }

  if (!session) return <AuthScreen />;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={plannedTasks}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshing={isLoadingTasks}
          onRefresh={() => void loadTasks()}
          ListHeaderComponent={
            <>
              <View style={styles.header}>
                <View>
                  <Text style={styles.eyebrow}>CADENZA</Text>
                  <Text style={styles.title}>La tua giornata</Text>
                  <Text style={styles.date}>{todayLabel}</Text>
                </View>
                <Pressable accessibilityLabel="Esci dall'account" onPress={() => void signOut()} style={styles.avatar}>
                  <Text style={styles.avatarText}>{session.user.email?.slice(0, 1).toUpperCase() ?? 'C'}</Text>
                </Pressable>
              </View>

              <View style={styles.focusCard}>
                <View style={styles.focusCopy}>
                  <Text style={styles.focusLabel}>IL TUO RITMO DI OGGI</Text>
                  <Text style={styles.focusTitle}>Un passo alla volta.</Text>
                  <Text style={styles.focusDescription}>{plannedMinutes} minuti da dedicare a te.</Text>
                </View>
                <View style={styles.focusCircle}>
                  <Text style={styles.focusCircleNumber}>{plannedTasks.filter((task) => !task.is_complete).length}</Text>
                  <Text style={styles.focusCircleLabel}>oggi</Text>
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Pianificati</Text>
                <Text style={styles.sectionCount}>{plannedTasks.length} task</Text>
              </View>

              {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
            </>
          }
          renderItem={({ item: task }) => <SwipeableTask task={task} onToggle={() => void toggleTask(task)} onEdit={() => openEditTask(task)} onDelete={() => void deleteTask(task)} />}
          ListEmptyComponent={!isLoadingTasks ? <Text style={styles.emptyText}>Nessun task pianificato. Scegli un giorno per iniziare.</Text> : undefined}
          ListFooterComponent={<View style={styles.backlogSection}>
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Note sparse</Text><Text style={styles.sectionCount}>{backlogTasks.length} task</Text></View>
            <Text style={styles.backlogDescription}>Cose da fare che devono ancora trovare posto nello spartito.</Text>
            {backlogTasks.map((task) => <SwipeableTask key={task.id} task={task} onToggle={() => void toggleTask(task)} onEdit={() => openEditTask(task)} onDelete={() => void deleteTask(task)} />)}
            {!backlogTasks.length && <Text style={styles.emptyText}>Tutto accordato. Che armonia!</Text>}
          </View>}
        />

        <Pressable accessibilityRole="button" accessibilityLabel="Aggiungi un nuovo task" onPress={openComposer} style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}>
          <Text style={styles.addIcon}>+</Text><Text style={styles.addButtonText}>Aggiungi task</Text>
        </Pressable>
      </SafeAreaView>

      <Modal animationType="slide" transparent visible={isComposerOpen} onRequestClose={closeComposer}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityLabel="Chiudi modulo task" onPress={closeComposer} style={styles.modalDismissArea} />
          <View style={styles.modalCard}>
            <ScrollView ref={composerScrollRef} style={styles.modalScroller} contentContainerStyle={styles.modalScrollContent} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editingTask ? 'Modifica task' : 'Nuovo task'}</Text>
            <Text style={styles.modalSubtitle}>Pianificalo oppure lascialo tra le note sparse.</Text>
            {voiceStep && <View style={styles.voiceWizardCard}><Text style={styles.voiceWizardLabel}>GUIDA VOCALE · {voiceStep === 'title' ? '1' : voiceStep === 'category' ? '2' : voiceStep === 'priority' ? '3' : voiceStep === 'duration' ? '4' : voiceStep === 'dueDate' ? '5' : '6'} DI 6</Text><Text style={styles.voiceWizardPrompt}>{voiceStepPrompts[voiceStep]}</Text><Text style={styles.voiceWizardState}>{isListening ? 'In ascolto…' : 'Tocca il microfono per ripetere.'}</Text></View>}
            {voiceTranscript && <View style={styles.voiceTranscriptCard}><Text style={styles.voiceTranscriptLabel}>HAI DETTO</Text><Text style={styles.voiceTranscriptText}>{voiceTranscript}</Text></View>}
            <View onLayout={(event) => rememberVoiceStepPosition('title', event.nativeEvent.layout.y)} style={[styles.voiceStepSection, voiceStep === 'title' && styles.voiceStepSectionActive]}>
              <Text style={styles.fieldLabel}>TITOLO DEL TASK</Text>
              <View style={styles.voiceInputRow}>
                <TextInput autoFocus placeholder="Es. Prenotare la visita" placeholderTextColor="#938F8B" value={newTaskTitle} onFocus={interruptVoiceGuide} onChangeText={(value) => { setNewTaskTitle(value); setVoiceSummary(null); }} onSubmitEditing={() => void addTask()} returnKeyType="done" style={[styles.input, styles.voiceTextInput]} />
                <Pressable accessibilityRole="button" accessibilityLabel={isListening ? 'Ferma dettatura' : 'Avvia guida vocale'} onPress={toggleVoiceInput} style={[styles.voiceButton, isListening && styles.voiceButtonActive]}>
                  <Text style={styles.voiceButtonIcon}>{isListening ? '■' : '🎙'}</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.voiceHint, isListening && styles.voiceHintActive]}>{isListening ? 'Parla normalmente; Cadenza passa avanti quando riconosce la risposta.' : 'Tocca il microfono per completare titolo, categoria, priorità e durata.'}</Text>
            {voiceSummary && <Text style={styles.voiceSummary}>{voiceSummary}</Text>}
            <View onTouchStart={interruptVoiceGuide} onLayout={(event) => rememberVoiceStepPosition('category', event.nativeEvent.layout.y)} style={[styles.voiceStepSection, voiceStep === 'category' && styles.voiceStepSectionActive]}>
              <Text style={styles.fieldLabel}>CATEGORIA</Text>
              <View style={styles.optionRow}>
                {(['Personale', 'Lavoro'] as Category[]).map((category) => (
                  <Pressable key={category} onPress={() => setNewTaskCategory(category)} style={[styles.choiceButton, newTaskCategory === category && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskCategory === category && styles.choiceTextSelected]}>{category}</Text></Pressable>
                ))}
              </View>
            </View>
            <View onTouchStart={interruptVoiceGuide} onLayout={(event) => rememberVoiceStepPosition('priority', event.nativeEvent.layout.y)} style={[styles.voiceStepSection, voiceStep === 'priority' && styles.voiceStepSectionActive]}>
              <Text style={styles.fieldLabel}>PRIORITÀ</Text>
              <View style={styles.optionRow}>
                {(['Alta', 'Media', 'Bassa'] as Priority[]).map((priority) => (
                  <Pressable key={priority} onPress={() => setNewTaskPriority(priority)} style={[styles.choiceButton, newTaskPriority === priority && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskPriority === priority && styles.choiceTextSelected]}>{priority}</Text></Pressable>
                ))}
              </View>
            </View>
            <View onTouchStart={interruptVoiceGuide} onLayout={(event) => rememberVoiceStepPosition('duration', event.nativeEvent.layout.y)} style={[styles.voiceStepSection, voiceStep === 'duration' && styles.voiceStepSectionActive]}>
              <Text style={styles.fieldLabel}>DURATA STIMATA</Text>
              <View style={styles.optionRow}>
                {[15, 30, 45, 60].map((duration) => (
                  <Pressable key={duration} onPress={() => { setNewTaskDuration(duration); setIsCustomDuration(false); }} style={[styles.choiceButton, !isCustomDuration && newTaskDuration === duration && styles.choiceButtonSelected]}><Text style={[styles.choiceText, !isCustomDuration && newTaskDuration === duration && styles.choiceTextSelected]}>{formatDuration(duration)}</Text></Pressable>
                ))}
                <Pressable onPress={() => setIsCustomDuration(true)} style={[styles.choiceButton, isCustomDuration && styles.choiceButtonSelected]}><Text style={[styles.choiceText, isCustomDuration && styles.choiceTextSelected]}>Altro</Text></Pressable>
              </View>
            </View>
            {isCustomDuration && <View style={styles.customDurationRow}>
              <View style={styles.durationField}><Text style={styles.durationLabel}>GIORNI</Text><TextInput keyboardType="number-pad" value={customDays} onFocus={interruptVoiceGuide} onChangeText={setCustomDays} style={styles.durationInput} /></View>
              <View style={styles.durationField}><Text style={styles.durationLabel}>ORE</Text><TextInput keyboardType="number-pad" value={customHours} onFocus={interruptVoiceGuide} onChangeText={setCustomHours} style={styles.durationInput} /></View>
              <View style={styles.durationField}><Text style={styles.durationLabel}>MINUTI</Text><TextInput keyboardType="number-pad" value={customMinutes} onFocus={interruptVoiceGuide} onChangeText={setCustomMinutes} style={styles.durationInput} /></View>
            </View>}
            <View onTouchStart={interruptVoiceGuide}>
              <Text style={styles.fieldLabel}>PUÒ ESSERE SPEZZATO?</Text>
              <Text style={styles.dateHint}>Se scegli no, Cadenza lo pianifica solo quando trova uno spazio unico abbastanza lungo.</Text>
              <View style={styles.optionRow}>
                <Pressable onPress={() => setNewTaskSplittable(true)} style={[styles.choiceButton, newTaskSplittable && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskSplittable && styles.choiceTextSelected]}>Sì, in blocchi</Text></Pressable>
                <Pressable onPress={() => setNewTaskSplittable(false)} style={[styles.choiceButton, !newTaskSplittable && styles.choiceButtonSelected]}><Text style={[styles.choiceText, !newTaskSplittable && styles.choiceTextSelected]}>No, tutto insieme</Text></Pressable>
              </View>
            </View>
            <View onLayout={(event) => rememberVoiceStepPosition('dueDate', event.nativeEvent.layout.y)} style={[styles.voiceStepSection, voiceStep === 'dueDate' && styles.voiceStepSectionActive]}>
              <Text style={styles.fieldLabel}>GIORNO / SCADENZA</Text>
              <Text style={styles.dateHint}>Con un orario resta fisso; senza orario Cadenza lo pianifica entro quel giorno.</Text>
              <View style={styles.optionRow}>
                {quickDateOptions.map((option) => (
                  <Pressable key={option.label} onPress={() => { interruptVoiceGuide(); setNewTaskDate(option.value); if (!option.value) setNewTaskTime(''); }} style={[styles.choiceButton, newTaskDate === option.value && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskDate === option.value && styles.choiceTextSelected]}>{option.label}</Text></Pressable>
                ))}
              </View>
              <Pressable onPress={() => { interruptVoiceGuide(); openCalendar(); }} style={styles.calendarButton}><Text style={styles.calendarButtonLabel}>Calendario</Text><Text style={styles.calendarButtonValue}>{formatScheduledDate(newTaskDate) ?? 'Scegli un giorno'}</Text></Pressable>
            </View>
            <Text style={styles.fieldLabel}>ORARIO <Text style={styles.optionalLabel}>FACOLTATIVO</Text></Text>
            <TextInput keyboardType="number-pad" maxLength={5} placeholder="HH:MM  ·  es. 09:30" placeholderTextColor="#938F8B" value={newTaskTime} onFocus={interruptVoiceGuide} onChangeText={(value) => setNewTaskTime(formatTimeInput(value))} style={styles.input} />
            <Text style={styles.fieldLabel}>FASCIA ORARIA FORZATA <Text style={styles.optionalLabel}>FACOLTATIVA</Text></Text>
            <Text style={styles.dateHint}>Cadenza pianificherà il task soltanto fra questi due orari.</Text>
            <View style={styles.taskTimeRangeRow}>
              <TextInput keyboardType="number-pad" maxLength={5} placeholder="Dalle HH:MM" placeholderTextColor="#938F8B" value={newTaskWindowStart} onFocus={interruptVoiceGuide} onChangeText={(value) => setNewTaskWindowStart(formatTimeInput(value))} style={[styles.input, styles.taskTimeRangeInput]} />
              <TextInput keyboardType="number-pad" maxLength={5} placeholder="Alle HH:MM" placeholderTextColor="#938F8B" value={newTaskWindowEnd} onFocus={interruptVoiceGuide} onChangeText={(value) => setNewTaskWindowEnd(formatTimeInput(value))} style={[styles.input, styles.taskTimeRangeInput]} />
            </View>
            <View onTouchStart={interruptVoiceGuide}>
              <Text style={styles.fieldLabel}>PROMEMORIA</Text>
              <View style={styles.optionRow}>
                <Pressable onPress={() => setNewTaskReminderEnabled(true)} style={[styles.choiceButton, newTaskReminderEnabled && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskReminderEnabled && styles.choiceTextSelected]}>Sì</Text></Pressable>
                <Pressable onPress={() => setNewTaskReminderEnabled(false)} style={[styles.choiceButton, !newTaskReminderEnabled && styles.choiceButtonSelected]}><Text style={[styles.choiceText, !newTaskReminderEnabled && styles.choiceTextSelected]}>No</Text></Pressable>
              </View>
              {newTaskReminderEnabled && <><Text style={styles.fieldLabel}>QUANTI MINUTI PRIMA?</Text><View style={styles.optionRow}>{[0, 5, 10, 15, 30, 60].map((minutes) => <Pressable key={minutes} onPress={() => setNewTaskReminderMinutes(minutes)} style={[styles.choiceButton, newTaskReminderMinutes === minutes && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskReminderMinutes === minutes && styles.choiceTextSelected]}>{minutes ? `${minutes} min` : 'All’orario'}</Text></Pressable>)}</View></>}
            </View>
            <Pressable accessibilityRole="button" disabled={!newTaskTitle.trim() || isSaving} onPress={() => { interruptVoiceGuide(); void addTask(); }} style={({ pressed }) => [styles.saveButton, (!newTaskTitle.trim() || isSaving) && styles.saveButtonDisabled, pressed && styles.saveButtonPressed]}>
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>{editingTask ? 'Salva modifiche' : 'Salva task'}</Text>}
            </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={isCalendarOpen} onRequestClose={() => setIsCalendarOpen(false)}>
        <Pressable style={styles.calendarBackdrop} onPress={() => setIsCalendarOpen(false)}>
          <Pressable style={styles.calendarCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.calendarHeader}>
              <Pressable accessibilityLabel="Mese precedente" onPress={() => moveCalendarMonth(-1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>‹</Text></Pressable>
              <Text style={styles.calendarTitle}>{formatCalendarMonth(calendarCursor)}</Text>
              <Pressable accessibilityLabel="Mese successivo" onPress={() => moveCalendarMonth(1)} style={styles.calendarArrow}><Text style={styles.calendarArrowText}>›</Text></Pressable>
            </View>
            <View style={styles.weekdayRow}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
            <View style={styles.calendarGrid}>
              {getCalendarDays(calendarCursor).map((date, index) => {
                if (!date) return <View key={`empty-${index}`} style={styles.calendarDay} />;
                const dateKey = toDateKey(date);
                const isSelected = dateKey === newTaskDate;
                const isToday = dateKey === toDateKey(new Date());
                return <Pressable key={dateKey} onPress={() => chooseDate(date)} style={[styles.calendarDay, isSelected && styles.calendarDaySelected, isToday && !isSelected && styles.calendarDayToday]}><Text style={[styles.calendarDayText, isSelected && styles.calendarDayTextSelected]}>{date.getDate()}</Text></Pressable>;
              })}
            </View>
            <Pressable onPress={() => { setNewTaskDate(null); setNewTaskTime(''); setIsCalendarOpen(false); }} style={styles.backlogButton}><Text style={styles.backlogButtonText}>Lascia tra le note sparse</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { alignItems: 'center', backgroundColor: '#F7F5F1', flex: 1, justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: '#F7F5F1' }, safeArea: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 116 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 25 },
  eyebrow: { color: '#517060', fontSize: 11, fontWeight: '800', letterSpacing: 1.8, marginBottom: 8 }, title: { color: '#252A26', fontSize: 31, fontWeight: '700', letterSpacing: -1 }, date: { color: '#74716C', fontSize: 15, marginTop: 6 },
  avatar: { alignItems: 'center', backgroundColor: '#DCEADD', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, avatarText: { color: '#426251', fontSize: 20, fontWeight: '700' },
  focusCard: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 26, flexDirection: 'row', justifyContent: 'space-between', minHeight: 162, overflow: 'hidden', padding: 22 }, focusCopy: { flex: 1, paddingRight: 8 },
  focusLabel: { color: '#C6DBC9', fontSize: 10, fontWeight: '800', letterSpacing: 1.25, marginBottom: 10 }, focusTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', letterSpacing: -0.7, lineHeight: 29 }, focusDescription: { color: '#DCEADE', fontSize: 13, lineHeight: 18, marginTop: 10 },
  focusCircle: { alignItems: 'center', backgroundColor: '#DDEEDF', borderRadius: 48, height: 96, justifyContent: 'center', width: 96 }, focusCircleNumber: { color: '#305D4A', fontSize: 34, fontWeight: '700', lineHeight: 37 }, focusCircleLabel: { color: '#52705E', fontSize: 12, fontWeight: '600' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 30, paddingBottom: 13 }, sectionTitle: { color: '#2C302D', fontSize: 19, fontWeight: '700', letterSpacing: -0.3 }, sectionCount: { color: '#85817B', fontSize: 13, fontWeight: '600' }, backlogSection: { paddingTop: 8 }, backlogDescription: { color: '#827E77', fontSize: 13, lineHeight: 18, marginBottom: 13 }, errorText: { backgroundColor: '#FFF1E8', borderRadius: 12, color: '#9F3800', fontSize: 13, lineHeight: 19, marginBottom: 12, padding: 12 },
  taskWrapper: { borderRadius: 18, marginBottom: 10, overflow: 'hidden', position: 'relative' }, deleteAction: { alignItems: 'center', backgroundColor: '#D94A43', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', top: 0, width: 104 }, deleteActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, editAction: { alignItems: 'center', backgroundColor: '#F2C94C', bottom: 0, justifyContent: 'center', position: 'absolute', right: 0, top: 0, width: 104 }, editActionText: { color: '#4D3D00', fontSize: 13, fontWeight: '800' }, taskCard: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', minHeight: 82, paddingHorizontal: 14, paddingVertical: 13 }, workTaskCard: { backgroundColor: '#F0F2FF', borderColor: '#BBC5F1' }, personalTaskCard: { backgroundColor: '#FFF2EA', borderColor: '#F1CBB6' },
  check: { alignItems: 'center', borderColor: '#CBC7C0', borderRadius: 11, borderWidth: 1.5, height: 22, justifyContent: 'center', marginRight: 12, width: 22 }, checkDone: { backgroundColor: '#3F725B', borderColor: '#3F725B' }, checkMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: -1 },
  taskContent: { flex: 1 }, taskTitle: { color: '#323531', fontSize: 16, fontWeight: '700', lineHeight: 21 }, taskTitleDone: { color: '#8B8882', textDecorationLine: 'line-through' }, taskMeta: { alignItems: 'center', flexDirection: 'row', marginTop: 5 }, taskTime: { color: '#406755', fontSize: 12, fontWeight: '700' }, metaDot: { color: '#B7B2AA', fontSize: 12, marginHorizontal: 5 }, taskMetaText: { color: '#827E77', fontSize: 12 }, workTaskCategory: { color: '#3850A3', fontWeight: '800' }, personalTaskCategory: { color: '#A64E22', fontWeight: '800' },
  priorityPill: { borderRadius: 9, marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5 }, priorityText: { fontSize: 11, fontWeight: '800' }, emptyText: { color: '#827E77', fontSize: 15, paddingTop: 10, textAlign: 'center' },
  addButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 18, bottom: 18, elevation: 2, flexDirection: 'row', justifyContent: 'center', left: 20, paddingVertical: 17, position: 'absolute', right: 20, shadowColor: '#17392A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 12 }, addButtonPressed: { backgroundColor: '#274E3D' }, addIcon: { color: '#FFFFFF', fontSize: 23, fontWeight: '300', lineHeight: 23, marginRight: 8 }, addButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  modalBackdrop: { backgroundColor: 'rgba(24, 28, 24, 0.38)', flex: 1, justifyContent: 'flex-end' }, modalDismissArea: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }, modalCard: { backgroundColor: '#F8F7F3', borderTopLeftRadius: 28, borderTopRightRadius: 28, height: '92%', maxHeight: '92%', minHeight: 0 }, modalScroller: { flex: 1 }, modalScrollContent: { flexGrow: 1, paddingBottom: 48, paddingHorizontal: 22, paddingTop: 10 }, modalHandle: { alignSelf: 'center', backgroundColor: '#D3D0C9', borderRadius: 2, height: 4, marginBottom: 23, width: 38 }, modalTitle: { color: '#292D29', fontSize: 25, fontWeight: '700', letterSpacing: -0.5 }, modalSubtitle: { color: '#77736D', fontSize: 14, lineHeight: 20, marginTop: 7 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 14, borderWidth: 1, color: '#292D29', fontSize: 16, marginTop: 18, paddingHorizontal: 15, paddingVertical: 15 }, voiceWizardCard: { backgroundColor: '#305D4A', borderRadius: 14, marginTop: 16, padding: 13 }, voiceWizardLabel: { color: '#C6DBC9', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, voiceWizardPrompt: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 4 }, voiceWizardState: { color: '#DCEADE', fontSize: 11, marginTop: 5 }, voiceTranscriptCard: { backgroundColor: '#F0F2FF', borderColor: '#BBC5F1', borderRadius: 12, borderWidth: 1, marginTop: 16, padding: 11 }, voiceTranscriptLabel: { color: '#3850A3', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, voiceTranscriptText: { color: '#343B62', fontSize: 13, lineHeight: 19, marginTop: 4 }, voiceStepSection: { borderRadius: 14, marginHorizontal: -8, paddingHorizontal: 8 }, voiceStepSectionActive: { backgroundColor: '#E8F3EC', borderColor: '#9FBEA8', borderWidth: 1, marginTop: 10, paddingBottom: 12, paddingHorizontal: 12 }, voiceInputRow: { alignItems: 'center', flexDirection: 'row', gap: 9, marginTop: 8 }, voiceTextInput: { flex: 1, marginTop: 0 }, voiceButton: { alignItems: 'center', backgroundColor: '#E4F0E5', borderColor: '#7FA18A', borderRadius: 14, borderWidth: 1, height: 53, justifyContent: 'center', marginTop: 0, width: 53 }, voiceButtonActive: { backgroundColor: '#B54708', borderColor: '#B54708' }, voiceButtonIcon: { color: '#305D4A', fontSize: 22, lineHeight: 24 }, voiceHint: { color: '#8A857E', fontSize: 11, lineHeight: 16, marginTop: 7 }, voiceHintActive: { color: '#B54708', fontWeight: '700' }, voiceSummary: { backgroundColor: '#E8F3EC', borderRadius: 9, color: '#315D4A', fontSize: 11, fontWeight: '700', lineHeight: 16, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8 }, fieldLabel: { color: '#6C716B', fontSize: 10, fontWeight: '800', letterSpacing: 1.05, marginBottom: 8, marginTop: 16 }, optionalLabel: { color: '#A19C94', fontSize: 9 }, dateHint: { color: '#8A857E', fontSize: 11, lineHeight: 16, marginBottom: 9, marginTop: -2 }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceButton: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, choiceButtonSelected: { backgroundColor: '#E4F0E5', borderColor: '#3F725B' }, choiceText: { color: '#716D66', fontSize: 13, fontWeight: '700' }, choiceTextSelected: { color: '#315D4A' }, customDurationRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, durationField: { flex: 1 }, durationLabel: { color: '#78736C', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 5 }, durationInput: { backgroundColor: '#FFFFFF', borderColor: '#D7D3CC', borderRadius: 10, borderWidth: 1, color: '#292D29', fontSize: 16, paddingHorizontal: 11, paddingVertical: 10, textAlign: 'center' }, calendarButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 13, paddingVertical: 12 }, calendarButtonLabel: { color: '#5F6B63', fontSize: 13, fontWeight: '700' }, calendarButtonValue: { color: '#305D4A', fontSize: 13, fontWeight: '800' }, taskTimeRangeRow: { flexDirection: 'row', gap: 8 }, taskTimeRangeInput: { flex: 1, marginTop: 0, paddingHorizontal: 10, textAlign: 'center' }, saveButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 53 }, saveButtonDisabled: { backgroundColor: '#A8BBAE' }, saveButtonPressed: { opacity: 0.85 }, saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  calendarBackdrop: { alignItems: 'center', backgroundColor: 'rgba(24, 28, 24, 0.42)', flex: 1, justifyContent: 'center', padding: 20 }, calendarCard: { backgroundColor: '#F8F7F3', borderRadius: 24, maxWidth: 420, padding: 20, width: '100%' }, calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }, calendarArrow: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 }, calendarArrowText: { color: '#305D4A', fontSize: 32, fontWeight: '300', lineHeight: 34 }, calendarTitle: { color: '#292D29', fontSize: 17, fontWeight: '800' }, weekdayRow: { flexDirection: 'row', marginBottom: 6 }, weekday: { color: '#88837C', flex: 1, fontSize: 11, fontWeight: '800', textAlign: 'center' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarDay: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', marginVertical: 2, width: '14.2857%' }, calendarDayToday: { borderColor: '#87A590', borderWidth: 1 }, calendarDaySelected: { backgroundColor: '#305D4A' }, calendarDayText: { color: '#383C38', fontSize: 14, fontWeight: '700' }, calendarDayTextSelected: { color: '#FFFFFF' }, backlogButton: { alignItems: 'center', marginTop: 16, paddingVertical: 9 }, backlogButtonText: { color: '#765D00', fontSize: 13, fontWeight: '800' },
});
