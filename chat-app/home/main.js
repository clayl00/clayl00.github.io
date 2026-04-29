import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter(); 
    
    const newChatTitle = ref("");
    const recipientHandle = ref(""); 
    const dmError = ref("");

    const broadSchema = { properties: { value: { type: "object" } } };

    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);
    const discoveryChannel = computed(() => session.value ? [`discovery-${session.value.actor}`] : []);
    const globalChannel = ["composer-central-public"];

    const { objects: privateEntries } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    const { objects: publicEntries } = useGraffitiDiscover(globalChannel, broadSchema);
    const { objects: incomingInvites } = useGraffitiDiscover(discoveryChannel, broadSchema, session);
    
    // TRASH LOGIC: Discover trash flags in the user's private directory
    const trashSchema = { properties: { value: { properties: { type: { const: "ChatTrash" } } } } };
    const { objects: trashEntries } = useGraffitiDiscover(myDirChannel, trashSchema, session);
    const trashedChannels = computed(() => new Set(trashEntries.value.map(t => t.value.targetChannel)));

    // Filter discovery results manually
    const chatsFound = computed(() => [...privateEntries.value, ...publicEntries.value].filter(o => o.value?.type === 'Chat'));
    const invitesFound = computed(() => incomingInvites.value.filter(o => o.value?.type === 'ChatInvite'));

    // Profile Discovery for Sidebar Names
    const dmActors = computed(() => {
      const actors = new Set();
      chatsFound.value.forEach(c => {
        if (c.value?.isPrivate && c.value.participants) {
          c.value.participants.forEach(a => { if (a !== session.value?.actor) actors.add(a); });
        }
      });
      return [...actors];
    });

    const { objects: profiles } = useGraffitiDiscover(dmActors, broadSchema, session);

    function getProfileName(actorId) {
      if (!actorId) return ""; 
      const latest = profiles.value.filter(p => p.channels?.includes(actorId) && p.value?.type === 'Profile').sort((a, b) => b.value.published - a.value.published)[0];
      return latest?.value?.handle || actorId.substring(0, 8); 
    }

    function getOtherActor(participants) {
      if (!participants || !session.value) return "";
      return participants.find(a => a !== session.value.actor) || "";
    }

    // Handshake: Move invites into private directory
    watch(invitesFound, (invites) => {
      invites.forEach(async (invite) => {
        const exists = chatsFound.value.some(c => c.value.channel === invite.value.channel);
        if (!exists && session.value) {
          await graffiti.post({
            value: { ...invite.value, type: "Chat", published: Date.now() },
            channels: [`my-private-directory-${session.value.actor}`],
            allowed: [session.value.actor]
          }, session.value);
        }
      });
    }, { deep: true });

    const allChats = computed(() => {
      const unique = {};
      chatsFound.value.forEach(c => { unique[c.value.channel] = c; });
      // TRASH LOGIC: Filter out chats that are in the trashedChannels Set
      return Object.values(unique)
        .filter(c => !trashedChannels.value.has(c.value.channel))
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
    });

    const privateMessages = computed(() => allChats.value.filter(c => c.value.isPrivate === true));
    const groupChats = computed(() => allChats.value.filter(c => c.value.isPrivate !== true));

    async function createChat() {
      if (!newChatTitle.value.trim() || !session.value) return;
      const chatId = `chat-${crypto.randomUUID()}`;
      await graffiti.post({
        value: { type: "Chat", title: newChatTitle.value, channel: chatId, published: Date.now() },
        channels: globalChannel
      }, session.value);
      newChatTitle.value = "";
      router.push(`/chat/${chatId}`); 
    }

    async function createDM() {
      dmError.value = "";
      if (!recipientHandle.value.trim() || !session.value) return;
      try {
        const recipientActor = await graffiti.handleToActor(recipientHandle.value);
        if (!recipientActor) { dmError.value = "Handle not found."; return; }
        
        // SELF-DM PREVENTION
        if (recipientActor === session.value.actor) { 
          dmError.value = "You cannot DM yourself."; 
          return; 
        }

        const chatId = `dm-${[session.value.actor, recipientActor].sort().join('-')}`;
        const chatObj = {
          type: "Chat", title: `DM: ${recipientHandle.value}`, channel: chatId,
          isPrivate: true, participants: [session.value.actor, recipientActor], published: Date.now()
        };
        await graffiti.post({
          value: chatObj, channels: [`my-private-directory-${session.value.actor}`], allowed: [session.value.actor]
        }, session.value);
        await graffiti.post({
          value: { ...chatObj, type: "ChatInvite" }, channels: [`discovery-${recipientActor}`], allowed: [recipientActor]
        }, session.value);
        recipientHandle.value = "";
        router.push(`/chat/${chatId}`);
      } catch (e) { dmError.value = "Network error."; }
    }

    // TRASH LOGIC: Post a flag to hide this chat
    async function trashChat(chat) {
      if (!session.value) return;
      await graffiti.post({
        value: { type: "ChatTrash", targetChannel: chat.value.channel, published: Date.now() },
        channels: [`my-private-directory-${session.value.actor}`],
        allowed: [session.value.actor]
      }, session.value);
    }

    return { 
      chats: allChats, privateMessages, groupChats, newChatTitle, 
      createChat, recipientHandle, createDM, dmError, session, 
      getOtherActor, getProfileName, trashChat
    };
  }
});