// src/state/navigationStore.ts
// Navigation stack – no React imports in the store itself.

import { create } from 'zustand';
import type { NavFrame } from '../core/model/types';

interface NavigationState {
  stack: NavFrame[];
  /** Push a frame onto the stack */
  push: (frame: NavFrame) => void;
  /** Pop back to a specific index (0 = main) */
  popTo: (index: number) => void;
  /** Current frame */
  current: () => NavFrame;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  stack: [{ type: 'main' }],

  push(frame) {
    set(state => ({ stack: [...state.stack, frame] }));
  },

  popTo(index) {
    set(state => ({ stack: state.stack.slice(0, index + 1) }));
  },

  current() {
    const { stack } = get();
    return stack[stack.length - 1];
  },
}));
