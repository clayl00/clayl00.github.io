import { ref, computed } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    // OPTIMISTIC UI: Tracks items we are restoring OR deleting
    const pendingRemoval = ref(new Set());
    
    const broadSchema = { properties: { value: { type: "object" } } };
    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);
    const globalChannel = ["composer-central-public"];

    const { objects: privateEntries } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    const { objects: publicEntries } = useGraffitiDiscover(globalChannel, broadSchema);
    
    const hideSchema = { properties: { value: { properties: { type: { enum: ["ChatTrash", "ChatHidden"] } } } } };
    const { objects: hiddenEntries } = useGraffitiDiscover(myDirChannel, hideSchema, session);

    const chatsFound = computed(() => [...privateEntries.value, ...publicEntries.value].filter(o => o.value?.type === 'Chat'));
    
    const hiddenChannels = computed(() => new Set(hiddenEntries.value.map(t => t.value.targetChannel)));

    const hiddenChatsList = computed(() => {
      const unique = {};
      chatsFound.value.forEach(c => { unique[c.value.channel] = c; });
      
      return Object.values(unique)
        .filter(c => hiddenChannels.value.has(c.value.channel) && !pendingRemoval.value.has(c.value.channel))
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
    });

    async function restoreChat(chat) {
      if (!session.value) return;
      const hiddenObj = hiddenEntries.value.find(t => t.value.targetChannel === chat.value.channel);
      
      if (hiddenObj) {
        pendingRemoval.value.add(chat.value.channel);
        try {
          await graffiti.delete(hiddenObj.url, session.value);
        } catch (error) {
          pendingRemoval.value.delete(chat.value.channel);
        }
      }
    }

    async function permanentlyDeleteChat(chat) {
      if (!session.value) return;
      
      // Prompt user with native warning
      if (window.confirm("Are you sure you want to permanently delete this chat? This action is irreversible.")) {
        pendingRemoval.value.add(chat.value.channel);
        const hiddenObj = hiddenEntries.value.find(t => t.value.targetChannel === chat.value.channel);
        
        try {
          // Delete the hidden flag if it exists, then permanently delete the main Chat object
          if (hiddenObj) {
            await graffiti.delete(hiddenObj.url, session.value);
          }
          await graffiti.delete(chat.url, session.value);
        } catch (error) {
          pendingRemoval.value.delete(chat.value.channel);
        }
      }
    }

    return { hiddenChatsList, restoreChat, permanentlyDeleteChat, session };
  }
});