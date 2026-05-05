import { ref, computed } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    // OPTIMISTIC UI: Tracks items we are currently restoring so we can hide them instantly
    const pendingRestore = ref(new Set());
    
    const broadSchema = { properties: { value: { type: "object" } } };
    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);
    const globalChannel = ["composer-central-public"];

    const { objects: privateEntries } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    const { objects: publicEntries } = useGraffitiDiscover(globalChannel, broadSchema);
    
    const trashSchema = { properties: { value: { properties: { type: { const: "ChatTrash" } } } } };
    const { objects: trashEntries } = useGraffitiDiscover(myDirChannel, trashSchema, session);

    const chatsFound = computed(() => [...privateEntries.value, ...publicEntries.value].filter(o => o.value?.type === 'Chat'));
    
    const trashedChannels = computed(() => new Set(trashEntries.value.map(t => t.value.targetChannel)));

    const trashedChatsList = computed(() => {
      const unique = {};
      chatsFound.value.forEach(c => { unique[c.value.channel] = c; });
      
      return Object.values(unique)
        // Instantly filter out any items that are currently in the pendingRestore Set
        .filter(c => trashedChannels.value.has(c.value.channel) && !pendingRestore.value.has(c.value.channel))
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
    });

    async function restoreChat(chat) {
      if (!session.value) return;
      const trashObj = trashEntries.value.find(t => t.value.targetChannel === chat.value.channel);
      
      if (trashObj) {
        // 1. Instantly trigger the UI animation
        pendingRestore.value.add(chat.value.channel);
        
        try {
          // 2. Let the network request process in the background
          await graffiti.delete(trashObj.url, session.value);
        } catch (error) {
          // 3. If the network fails, revert the UI so the chat reappears
          pendingRestore.value.delete(chat.value.channel);
        }
      }
    }

    return { trashedChatsList, restoreChat, session };
  }
});