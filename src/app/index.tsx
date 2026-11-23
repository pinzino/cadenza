import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthScreen } from '@/components/auth-screen';
import { supabase } from '@/lib/supabase';

type Priority = 'Alta' | 'Media' | 'Bassa';
type Category = 'Lavoro' | 'Personale';

type Task = {
  id: string;
  title: string;
  category: Category;
  duration_minutes: number;
  priority: Priority;
  scheduled_date: string | null;
  scheduled_time: string | null;
  is_complete: boolean;
};

const priorityColors: Record<Priority, { text: string; background: string }> = {
  Alta: { text: '#B54708', background: '#FFF1E8' },
  Media: { text: '#7A5A00', background: '#FFF7D6' },
  Bassa: { text: '#37705B', background: '#EAF7F0' },
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
        <Pressable accessibilityRole="button" accessibilityLabel={`Segna ${task.title} come ${task.is_complete ? 'da fare' : 'completato'}`} onPress={onToggle} style={styles.taskCard}>
          <View style={[styles.check, task.is_complete && styles.checkDone]}>{task.is_complete && <Text style={styles.checkMark}>✓</Text>}</View>
          <View style={styles.taskContent}>
            <Text style={[styles.taskTitle, task.is_complete && styles.taskTitleDone]}>{task.title}</Text>
            <View style={styles.taskMeta}>
              {task.scheduled_time && <><Text style={styles.taskTime}>{task.scheduled_time.slice(0, 5)}</Text><Text style={styles.metaDot}>•</Text></>}
              <Text style={styles.taskMetaText}>{formatDuration(task.duration_minutes)}</Text>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.taskMetaText}>{task.category}</Text>
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
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customDays, setCustomDays] = useState('0');
  const [customHours, setCustomHours] = useState('1');
  const [customMinutes, setCustomMinutes] = useState('0');
  const [newTaskDate, setNewTaskDate] = useState<string | null>(toDateKey(new Date()));
  const [newTaskTime, setNewTaskTime] = useState('');
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(new Date());
  const [isSaving, setIsSaving] = useState(false);

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
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, is_complete')
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      setErrorMessage('Non riesco ancora a leggere i task. Esegui lo script schema.sql in Supabase.');
    } else {
      setTasks(data as Task[]);
    }
    setIsLoadingTasks(false);
  }, [session]);

  useEffect(() => {
    if (session) void Promise.resolve().then(loadTasks);
  }, [loadTasks, session]);

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
    if (scheduledTime === undefined) {
      Alert.alert('Orario non valido', 'Usa il formato HH:MM, per esempio 09:30.');
      return;
    }
    if (scheduledTime && !newTaskDate) {
      Alert.alert('Scegli un giorno', 'Un task senza data non può avere un orario.');
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
    };
    const result = editingTask
      ? await supabase.from('tasks').update(taskValues).eq('id', editingTask.id)
        .select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, is_complete').single()
      : await supabase.from('tasks').insert({ user_id: session.user.id, ...taskValues })
        .select('id, title, category, duration_minutes, priority, scheduled_date, scheduled_time, is_complete').single();
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

  function openComposer() {
    setEditingTask(null);
    setNewTaskTitle('');
    setNewTaskCategory('Personale');
    setNewTaskPriority('Media');
    setNewTaskDuration(30);
    setIsCustomDuration(false);
    setCustomDays('0');
    setCustomHours('1');
    setCustomMinutes('0');
    setNewTaskDate(toDateKey(new Date()));
    setNewTaskTime('');
    setIsComposerOpen(true);
  }

  function openEditTask(task: Task) {
    setEditingTask(task);
    setNewTaskTitle(task.title);
    setNewTaskCategory(task.category);
    setNewTaskPriority(task.priority);
    setNewTaskDate(task.scheduled_date);
    setNewTaskTime(task.scheduled_time?.slice(0, 5) ?? '');

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
    setIsComposerOpen(false);
    setEditingTask(null);
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
        <Pressable style={styles.modalBackdrop} onPress={closeComposer}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <ScrollView contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editingTask ? 'Modifica task' : 'Nuovo task'}</Text>
            <Text style={styles.modalSubtitle}>Pianificalo oppure lascialo tra le note sparse.</Text>
            <TextInput autoFocus placeholder="Es. Prenotare la visita" placeholderTextColor="#938F8B" value={newTaskTitle} onChangeText={setNewTaskTitle} onSubmitEditing={() => void addTask()} returnKeyType="done" style={styles.input} />
            <Text style={styles.fieldLabel}>CATEGORIA</Text>
            <View style={styles.optionRow}>
              {(['Personale', 'Lavoro'] as Category[]).map((category) => (
                <Pressable key={category} onPress={() => setNewTaskCategory(category)} style={[styles.choiceButton, newTaskCategory === category && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskCategory === category && styles.choiceTextSelected]}>{category}</Text></Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>PRIORITÀ</Text>
            <View style={styles.optionRow}>
              {(['Alta', 'Media', 'Bassa'] as Priority[]).map((priority) => (
                <Pressable key={priority} onPress={() => setNewTaskPriority(priority)} style={[styles.choiceButton, newTaskPriority === priority && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskPriority === priority && styles.choiceTextSelected]}>{priority}</Text></Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>DURATA STIMATA</Text>
            <View style={styles.optionRow}>
              {[15, 30, 45, 60].map((duration) => (
                <Pressable key={duration} onPress={() => { setNewTaskDuration(duration); setIsCustomDuration(false); }} style={[styles.choiceButton, !isCustomDuration && newTaskDuration === duration && styles.choiceButtonSelected]}><Text style={[styles.choiceText, !isCustomDuration && newTaskDuration === duration && styles.choiceTextSelected]}>{formatDuration(duration)}</Text></Pressable>
              ))}
              <Pressable onPress={() => setIsCustomDuration(true)} style={[styles.choiceButton, isCustomDuration && styles.choiceButtonSelected]}><Text style={[styles.choiceText, isCustomDuration && styles.choiceTextSelected]}>Altro</Text></Pressable>
            </View>
            {isCustomDuration && <View style={styles.customDurationRow}>
              <View style={styles.durationField}><Text style={styles.durationLabel}>GIORNI</Text><TextInput keyboardType="number-pad" value={customDays} onChangeText={setCustomDays} style={styles.durationInput} /></View>
              <View style={styles.durationField}><Text style={styles.durationLabel}>ORE</Text><TextInput keyboardType="number-pad" value={customHours} onChangeText={setCustomHours} style={styles.durationInput} /></View>
              <View style={styles.durationField}><Text style={styles.durationLabel}>MINUTI</Text><TextInput keyboardType="number-pad" value={customMinutes} onChangeText={setCustomMinutes} style={styles.durationInput} /></View>
            </View>}
            <Text style={styles.fieldLabel}>GIORNO / SCADENZA</Text>
            <Text style={styles.dateHint}>Con un orario resta fisso; senza orario Cadenza lo pianifica entro quel giorno.</Text>
            <View style={styles.optionRow}>
              {quickDateOptions.map((option) => (
                <Pressable key={option.label} onPress={() => { setNewTaskDate(option.value); if (!option.value) setNewTaskTime(''); }} style={[styles.choiceButton, newTaskDate === option.value && styles.choiceButtonSelected]}><Text style={[styles.choiceText, newTaskDate === option.value && styles.choiceTextSelected]}>{option.label}</Text></Pressable>
              ))}
            </View>
            <Pressable onPress={openCalendar} style={styles.calendarButton}><Text style={styles.calendarButtonLabel}>Calendario</Text><Text style={styles.calendarButtonValue}>{formatScheduledDate(newTaskDate) ?? 'Scegli un giorno'}</Text></Pressable>
            <Text style={styles.fieldLabel}>ORARIO <Text style={styles.optionalLabel}>FACOLTATIVO</Text></Text>
            <TextInput keyboardType="numbers-and-punctuation" maxLength={5} placeholder="HH:MM  ·  es. 09:30" placeholderTextColor="#938F8B" value={newTaskTime} onChangeText={setNewTaskTime} style={styles.input} />
            <Pressable accessibilityRole="button" disabled={!newTaskTitle.trim() || isSaving} onPress={() => void addTask()} style={({ pressed }) => [styles.saveButton, (!newTaskTitle.trim() || isSaving) && styles.saveButtonDisabled, pressed && styles.saveButtonPressed]}>
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>{editingTask ? 'Salva modifiche' : 'Salva task'}</Text>}
            </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
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
  taskWrapper: { borderRadius: 18, marginBottom: 10, overflow: 'hidden', position: 'relative' }, deleteAction: { alignItems: 'center', backgroundColor: '#D94A43', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', top: 0, width: 104 }, deleteActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, editAction: { alignItems: 'center', backgroundColor: '#F2C94C', bottom: 0, justifyContent: 'center', position: 'absolute', right: 0, top: 0, width: 104 }, editActionText: { color: '#4D3D00', fontSize: 13, fontWeight: '800' }, taskCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E9E5DE', borderRadius: 18, borderWidth: 1, flexDirection: 'row', minHeight: 82, paddingHorizontal: 14, paddingVertical: 13 },
  check: { alignItems: 'center', borderColor: '#CBC7C0', borderRadius: 11, borderWidth: 1.5, height: 22, justifyContent: 'center', marginRight: 12, width: 22 }, checkDone: { backgroundColor: '#3F725B', borderColor: '#3F725B' }, checkMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: -1 },
  taskContent: { flex: 1 }, taskTitle: { color: '#323531', fontSize: 16, fontWeight: '700', lineHeight: 21 }, taskTitleDone: { color: '#8B8882', textDecorationLine: 'line-through' }, taskMeta: { alignItems: 'center', flexDirection: 'row', marginTop: 5 }, taskTime: { color: '#406755', fontSize: 12, fontWeight: '700' }, metaDot: { color: '#B7B2AA', fontSize: 12, marginHorizontal: 5 }, taskMetaText: { color: '#827E77', fontSize: 12 },
  priorityPill: { borderRadius: 9, marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5 }, priorityText: { fontSize: 11, fontWeight: '800' }, emptyText: { color: '#827E77', fontSize: 15, paddingTop: 10, textAlign: 'center' },
  addButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 18, bottom: 18, elevation: 2, flexDirection: 'row', justifyContent: 'center', left: 20, paddingVertical: 17, position: 'absolute', right: 20, shadowColor: '#17392A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 12 }, addButtonPressed: { backgroundColor: '#274E3D' }, addIcon: { color: '#FFFFFF', fontSize: 23, fontWeight: '300', lineHeight: 23, marginRight: 8 }, addButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  modalBackdrop: { backgroundColor: 'rgba(24, 28, 24, 0.38)', flex: 1, justifyContent: 'flex-end' }, modalCard: { backgroundColor: '#F8F7F3', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%' }, modalScrollContent: { paddingBottom: 38, paddingHorizontal: 22, paddingTop: 10 }, modalHandle: { alignSelf: 'center', backgroundColor: '#D3D0C9', borderRadius: 2, height: 4, marginBottom: 23, width: 38 }, modalTitle: { color: '#292D29', fontSize: 25, fontWeight: '700', letterSpacing: -0.5 }, modalSubtitle: { color: '#77736D', fontSize: 14, lineHeight: 20, marginTop: 7 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 14, borderWidth: 1, color: '#292D29', fontSize: 16, marginTop: 18, paddingHorizontal: 15, paddingVertical: 15 }, fieldLabel: { color: '#6C716B', fontSize: 10, fontWeight: '800', letterSpacing: 1.05, marginBottom: 8, marginTop: 16 }, optionalLabel: { color: '#A19C94', fontSize: 9 }, dateHint: { color: '#8A857E', fontSize: 11, lineHeight: 16, marginBottom: 9, marginTop: -2 }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceButton: { backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 }, choiceButtonSelected: { backgroundColor: '#E4F0E5', borderColor: '#3F725B' }, choiceText: { color: '#716D66', fontSize: 13, fontWeight: '700' }, choiceTextSelected: { color: '#315D4A' }, customDurationRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, durationField: { flex: 1 }, durationLabel: { color: '#78736C', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 5 }, durationInput: { backgroundColor: '#FFFFFF', borderColor: '#D7D3CC', borderRadius: 10, borderWidth: 1, color: '#292D29', fontSize: 16, paddingHorizontal: 11, paddingVertical: 10, textAlign: 'center' }, calendarButton: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E0DCD5', borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 13, paddingVertical: 12 }, calendarButtonLabel: { color: '#5F6B63', fontSize: 13, fontWeight: '700' }, calendarButtonValue: { color: '#305D4A', fontSize: 13, fontWeight: '800' }, saveButton: { alignItems: 'center', backgroundColor: '#305D4A', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 53 }, saveButtonDisabled: { backgroundColor: '#A8BBAE' }, saveButtonPressed: { opacity: 0.85 }, saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  calendarBackdrop: { alignItems: 'center', backgroundColor: 'rgba(24, 28, 24, 0.42)', flex: 1, justifyContent: 'center', padding: 20 }, calendarCard: { backgroundColor: '#F8F7F3', borderRadius: 24, maxWidth: 420, padding: 20, width: '100%' }, calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }, calendarArrow: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 }, calendarArrowText: { color: '#305D4A', fontSize: 32, fontWeight: '300', lineHeight: 34 }, calendarTitle: { color: '#292D29', fontSize: 17, fontWeight: '800' }, weekdayRow: { flexDirection: 'row', marginBottom: 6 }, weekday: { color: '#88837C', flex: 1, fontSize: 11, fontWeight: '800', textAlign: 'center' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarDay: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', marginVertical: 2, width: '14.2857%' }, calendarDayToday: { borderColor: '#87A590', borderWidth: 1 }, calendarDaySelected: { backgroundColor: '#305D4A' }, calendarDayText: { color: '#383C38', fontSize: 14, fontWeight: '700' }, calendarDayTextSelected: { color: '#FFFFFF' }, backlogButton: { alignItems: 'center', marginTop: 16, paddingVertical: 9 }, backlogButtonText: { color: '#765D00', fontSize: 13, fontWeight: '800' },
});
