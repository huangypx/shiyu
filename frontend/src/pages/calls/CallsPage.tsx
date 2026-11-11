import { useFeedback } from '@/app/useFeedback';
import { useCallsStore } from '@/features/calls/callsStore';
import CallsView from '@/features/calls/CallsView';

export default function CallsPage() {
  const calls = useCallsStore((state) => state.calls);
  const clear = useCallsStore((state) => state.clear);
  const feedback = useFeedback();

  return (
    <CallsView
      calls={calls}
      onClear={async () => {
        await clear();
        feedback('调用记录已清空');
      }}
    />
  );
}
