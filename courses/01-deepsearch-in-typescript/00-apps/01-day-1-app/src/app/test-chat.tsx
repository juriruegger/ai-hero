import { useChat } from "@ai-sdk/react";

export function TestChat() {
  const chat = useChat();
  
  // Let's see what properties are available
  console.log(Object.keys(chat));
  
  return (
    <div>
      <pre>{JSON.stringify(Object.keys(chat), null, 2)}</pre>
    </div>
  );
}
