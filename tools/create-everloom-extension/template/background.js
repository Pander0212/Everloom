/// <reference types="@everloom/script-types" />
// Runs hidden in every chat while the extension is on. Listen to events, register commands.

everloom.slash.register('hello', { help: 'Say hello', usage: '/hello' }, async () => {
  const messages = await everloom.chat.messages({ last: 1 });
  await everloom.ui.toast(`Hello from __NAME__! The last message was from ${messages[0]?.name ?? 'nobody'}.`);
  return 'hello';
});

everloom.on('message', (e) => everloom.log('A reply arrived:', e.messageId));
