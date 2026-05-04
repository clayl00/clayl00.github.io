import { ref, computed } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    // ANIMATION TRACKER: Keeps track of which chats are fading out to be restored
    const isRestoring = ref([]);
    
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
        .filter(c => trashedChannels.value.has(c.value.channel))
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
    });

    // Delete the "ChatTrash" object to restore it, but with an animation delay
    async function restoreChat(chat) {
      if (!session.value) return;
      const trashObj = trashEntries.value.find(t => t.value.targetChannel === chat.value.channel);
      
      if (trashObj) {
        // 1. Add channel to array to instantly trigger the CSS fade animation
        isRestoring.value.push(chat.value.channel);
        
        // 2. Wait 350ms for the fade-out to finish, then delete from database
        setTimeout(async () => {
          await graffiti.delete(trashObj.url, session.value);
          
          // Cleanup state by removing from array
          isRestoring.value = isRestoring.value.filter(id => id !== chat.value.channel);
        }, 350);
      }
    }

    return { trashedChatsList, restoreChat, session, isRestoring };
  }
});