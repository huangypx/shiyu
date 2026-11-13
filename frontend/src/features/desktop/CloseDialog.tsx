import {
  Button,
  Checkbox,
  Dialog,
  Flex,
  IconButton,
  Text,
} from '@radix-ui/themes';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';

import { resolveWindowClose } from '@/services/bridge';

// 关闭确认框：托盘常驻，关闭主窗口不等于退出。用户可选后台运行或直接
// 退出；勾选记住后写回 CloseAction，以后不再询问。
export default function CloseDialog() {
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function choose(action: 'background' | 'quit' | 'cancel') {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await resolveWindowClose(action, action !== 'cancel' && remember);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void choose('cancel');
      }}
    >
      <Dialog.Content maxWidth="350px" aria-describedby={undefined}>
        <Flex justify="between" align="center" mb="4">
          <Dialog.Title mb="0">关闭拾语</Dialog.Title>
          <IconButton
            aria-label="取消关闭"
            variant="ghost"
            color="gray"
            onClick={() => void choose('cancel')}
          >
            <X size={16} />
          </IconButton>
        </Flex>
        <Text as="p" size="2" color="gray" mb="4">
          拾语会在后台继续运行，可随时从托盘或悬浮球恢复。
        </Text>
        <Flex gap="2" justify="end">
          <Button
            variant="soft"
            color="gray"
            onClick={() => void choose('quit')}
          >
            直接退出
          </Button>
          <Button
            highContrast
            color="gray"
            onClick={() => void choose('background')}
          >
            后台运行
          </Button>
        </Flex>
        <Text as="label" size="2" color="gray">
          <Flex as="span" align="center" gap="2" mt="4">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            记住本次选择，以后不再询问
          </Flex>
        </Text>
        {error && (
          <Text as="p" size="2" color="red" role="alert">
            {error}
          </Text>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
