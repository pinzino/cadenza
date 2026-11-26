import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, View, StyleSheet, useWindowDimensions } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%', paddingTop: 78 }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="planify" href="/planify" asChild>
            <TabButton>Pianifica</TabButton>
          </TabTrigger>
          <TabTrigger name="agenda" href="/" asChild>
            <TabButton>Agenda</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Impostazioni</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const pressableProps = props as unknown as ComponentProps<typeof Pressable>;
  return (
    <Pressable {...pressableProps} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const compact = useWindowDimensions().width < 600;
  return (
    <View {...props} style={[styles.tabListContainer, compact && styles.compactTabList]}>
      <ThemedView type="backgroundElement" style={[styles.innerContainer, compact && styles.compactInnerContainer]}>
        <ThemedText type="smallBold" style={[styles.brandText, compact && styles.compactBrand]}>
          Cadenza
        </ThemedText>

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  compactTabList: { paddingHorizontal: 4 },
  compactInnerContainer: { gap: 0, justifyContent: 'space-around', paddingHorizontal: 4 },
  compactBrand: { display: 'none' },
  tabListContainer: {
    position: 'absolute',
    top: 0,
    zIndex: 20,
    width: '100%',
    minHeight: 66,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    backgroundColor: '#F7F5F1',
    borderBottomColor: '#E8E4DC',
    borderBottomWidth: 1,
  },
  innerContainer: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
    color: '#305D4A',
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
