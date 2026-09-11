/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#111B21',
    background: '#F7F9FC',
    backgroundElement: '#F0F2F5',
    backgroundSelected: '#E9EDEF',
    textSecondary: '#667781',
    textMuted: '#54656F',
    surface: '#F7F9FC',
    surfaceLowest: '#FFFFFF',
    surfaceLow: '#F2F4F7',
    surfaceContainer: '#ECEEF1',
    accent: '#00A884',
    accentInk: '#008069',
    primary: '#006B53',
    secondaryFixed: '#C9ECC3',
    outline: '#6C7A74',
    separator: '#F0F2F5',
    unreadOnAccent: '#FFFFFF',
    manual: '#DC2626',
    manualFill: '#FEE2E2',
    chatWallpaper: '#ECE5DD',
    bubbleIn: '#FFFFFF',
    bubbleOut: '#D9FDD3',
    bubbleOutText: '#111B21',
    unread: '#25D366',
    readTicks: '#53BDEB',
    readTime: '#8696A0',
    filterBg: '#E7FCE8',
    filterBorder: '#C6E9C0',
  },
  dark: {
    text: '#F4F4F5',
    background: '#111111',
    backgroundElement: '#2A2A2C',
    backgroundSelected: '#2A2A2C',
    textSecondary: '#8696A0',
    textMuted: '#8696A0',
    surface: '#111111',
    surfaceLowest: '#1C1C1E',
    surfaceLow: '#202C33',
    surfaceContainer: '#2A2A2C',
    accent: '#00A884',
    accentInk: '#00A884',
    primary: '#59DCB5',
    secondaryFixed: '#304E2F',
    outline: '#BCCAC2',
    separator: '#2A2A2C',
    unreadOnAccent: '#FFFFFF',
    manual: '#EF4444',
    manualFill: '#7F1D1D',
    chatWallpaper: '#0B141A',
    bubbleIn: '#202C33',
    bubbleOut: '#005C4B',
    bubbleOutText: '#E9EDEF',
    unread: '#25D366',
    readTicks: '#53BDEB',
    readTime: '#8696A0',
    filterBg: '#1A3328',
    filterBorder: '#1A3328',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
