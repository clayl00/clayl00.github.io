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
    const pendingHide = ref(new Set());

    // REACTIVE HANDLE RESOLUTION
    const resolvedHandles = ref({});

    const broadSchema = { properties: { value: { type: "object" } } };

    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);
    const discoveryChannel = computed(() => session.value ? [`discovery-${session.value.actor}`] : []);
    const globalChannel = ["composer-central-public"];

    const { objects: privateEntries } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    const { objects: publicEntries } = useGraffitiDiscover(globalChannel, broadSchema);
    const { objects: incomingInvites } = useGraffitiDiscover(discoveryChannel, broadSchema, session);
    
    const hideSchema = { properties: { value: { properties: { type: { enum: ["ChatTrash", "ChatHidden"] } } } } };
    const { objects: hiddenEntries } = useGraffitiDiscover(myDirChannel, hideSchema, session);
    const hiddenChannels = computed(() => new Set(hiddenEntries.value.map(t => t.value.targetChannel)));

    const chatsFound = computed(() => [...privateEntries.value, ...publicEntries.value].filter(o => o.value?.type === 'Chat'));
    const invitesFound = computed(() => incomingInvites.value.filter(o => o.value?.type === 'ChatInvite'));

    // Track all unique actors across direct messages to resolve their handles
    const uniqueActors = computed(() => {
      const actors = new Set();
      chatsFound.value.forEach(c => {
        if (c.value?.isPrivate && c.value.participants) {
          c.value.participants.forEach(a => { if (a !== session.value?.actor) actors.add(a); });
        }
      });
      return Array.from(actors);
    });

    // Resolve Actor IDs to Usernames asynchronously
    watch(uniqueActors, (actors) => {
      actors.forEach(async (actorId) => {
        if (actorId && !resolvedHandles.value[actorId]) {
          // 1. Instantly set a clean fallback while we wait for the network
          let cleanId = actorId.replace('https://', '').replace(/^did:[a-z0-9]+:/i, ''); 
          resolvedHandles.value[actorId] = cleanId.length > 20 ? cleanId.substring(0, 8) : cleanId;
          
          try {
            // 2. Fetch the official handle from the network
            const handle = await graffiti.actorToHandle(actorId);
            if (handle) {
              // 3. Strip the domain and update UI
              resolvedHandles.value[actorId] = handle.replace('.graffiti.actor', '');
            }
          } catch (e) {
            // Fails silently
          }
        }
      });
    }, { immediate: true });

    function getProfileName(actorId) {
      if (!actorId) return "";
      return resolvedHandles.value[actorId] || actorId.substring(0, 8);
    }

    function formatChatName(chat) {
      if (!chat?.value) return "";
      let name = chat.value.title || "";
      if (chat.value.participants && session.value?.actor) {
        const otherActor = chat.value.participants.find(p => p !== session.value.actor);
        if (otherActor) {
          const profileName = getProfileName(otherActor);
          if (profileName && profileName !== otherActor.replace('https://', '').replace(/^did:[a-z0-9]+:/i, '').substring(0, 8)) {
            name = profileName;
          }
        }
      }
      return name.replace('.graffiti.actor', '').replace(/^DM:\s*/i, '');
    }

    function getOtherActor(participants) {
      if (!participants || !session.value) return "";
      return participants.find(a => a !== session.value.actor) || "";
    }

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
      return Object.values(unique)
        .filter(c => !hiddenChannels.value.has(c.value.channel) && !pendingHide.value.has(c.value.channel))
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
        if (recipientActor === session.value.actor) { dmError.value = "You cannot DM yourself."; return; }

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

    async function hideChat(chat) {
      if (!session.value) return;
      pendingHide.value.add(chat.value.channel);
      try {
        await graffiti.post({
          value: { type: "ChatHidden", targetChannel: chat.value.channel, published: Date.now() },
          channels: [`my-private-directory-${session.value.actor}`],
          allowed: [session.value.actor]
        }, session.value);
      } catch (error) { pendingHide.value.delete(chat.value.channel); }
    }

    return { 
      chats: allChats, privateMessages, groupChats, newChatTitle, 
      createChat, recipientHandle, createDM, dmError, session, 
      getOtherActor, getProfileName, hideChat, formatChatName 
    };
  }
});