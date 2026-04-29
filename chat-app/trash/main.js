import { computed } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    const broadSchema = { properties: { value: { type: "object" } } };
    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);
    const globalChannel = ["composer-central-public"];

    const { objects: privateEntries } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    const { objects: publicEntries } = useGraffitiDiscover(globalChannel, broadSchema);
    
    const trashSchema = { properties: { value: { properties: { type: { const: "ChatTrash" } } } } };
    const { objects: trashEntries } = useGraffitiDiscover(myDirChannel, trashSchema, session);

    const chatsFound = computed(() => [...privateEntries.value, ...publicEntries.value].filter(o => o.value?.type === 'Chat'));
    
    // Create a Set of just the channels that HAVE been trashed
    const trashedChannels = computed(() => new Set(trashEntries.value.map(t => t.value.targetChannel)));

    // Filter TO include ONLY trashed chats
    const trashedChatsList = computed(() => {
      const unique = {};
      chatsFound.value.forEach(c => { unique[c.value.channel] = c; });
      
      return Object.values(unique)
        .filter(c => trashedChannels.value.has(c.value.channel))
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
    });

    // Delete the "ChatTrash" object to restore it to the home view
    async function restoreChat(chat) {
      if (!session.value) return;
      const trashObj = trashEntries.value.find(t => t.value.targetChannel === chat.value.channel);
      if (trashObj) {
        await graffiti.delete(trashObj.url, session.value);
      }
    }

    return { trashedChatsList, restoreChat, session };
  }
});