import { useUiStore } from '@/store/uiStore';

export function useFeedback() {
  return useUiStore((state) => state.notify);
}
