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

    const uniqueActors = computed(() => {
      const actors = new Set();
      chatsFound.value.forEach(c => {
        if (c.value?.isPrivate && c.value.participants) {
          c.value.participants.forEach(a => { if (a !== session.value?.actor) actors.add(a); });
        }
      });
      return Array.from(actors);
    });

    const profileChannels = computed(() => {
      const channels = new Set(["composer-central-public", "profiles"]);
      uniqueActors.value.forEach(a => {
        channels.add(a);
        channels.add(`discovery-${a}`);
      });
      if (session.value?.actor) {
         channels.add(session.value.actor);
         channels.add(`discovery-${session.value.actor}`);
      }
      return Array.from(channels);
    });
    
    const { objects: dmProfiles } = useGraffitiDiscover(profileChannels, broadSchema, session);

    watch(uniqueActors, (actors) => {
      actors.forEach(async (actorId) => {
        if (actorId && !resolvedHandles.value[actorId]) {
          let cleanId = actorId.replace('https://', '').replace(/^did:[a-z0-9]+:/i, ''); 
          resolvedHandles.value[actorId] = cleanId.length > 20 ? cleanId.substring(0, 8) : cleanId;
          
          try {
            const handle = await graffiti.actorToHandle(actorId);
            if (handle) {
              resolvedHandles.value[actorId] = handle.replace('.graffiti.actor', '');
            }
          } catch (e) {}
        }
      });
    }, { immediate: true });

    function getProfileName(actorId) {
      if (!actorId) return "";

      const allKnownObjects = [...publicEntries.value, ...privateEntries.value, ...dmProfiles.value];
      
      const profile = allKnownObjects
        .filter(p => p.actor === actorId && p.value?.type === 'Profile')
        .sort((a, b) => (b.value?.published || 0) - (a.value?.published || 0))[0];
        
      if (profile && profile.value) {
        const customName = profile.value.handle || profile.value.name || profile.value.displayName;
        if (customName && typeof customName === 'string' && customName.trim() !== '') {
          return customName; 
        }
      }

      if (resolvedHandles.value[actorId]) {
        return resolvedHandles.value[actorId].toLowerCase();
      }

      let cleanId = actorId.replace('https://', '').replace(/^did:[a-z0-9]+:/i, ''); 
      return cleanId.length > 20 ? cleanId.substring(0, 8) : cleanId;
    }

    function formatChatName(chat) {
      if (!chat?.value) return "";
      
      if (!chat.value.isPrivate) return chat.value.title || "Untitled Chat";
      
      const otherActor = chat.value.participants?.find(p => p !== session.value?.actor);
      
      if (!otherActor) {
        return (chat.value.title || "Empty Chat")
          .replace(/^DM:\s*/i, '')
          .replace('.graffiti.actor', '');
      }

      return getProfileName(otherActor);
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

    // --- UPDATED SMART DM CREATION LOGIC ---
    async function createDM() {
      dmError.value = "";
      const input = recipientHandle.value.trim();
      if (!input || !session.value) return;

      try {
        let recipientActor = null;

        // 1. Check if the input matches any known Custom Profile Name (case-insensitive)
        const allKnownObjects = [...publicEntries.value, ...privateEntries.value, ...dmProfiles.value];
        const matchingProfile = allKnownObjects.find(p => {
          if (p.value?.type === 'Profile') {
            const customName = p.value.handle || p.value.name || p.value.displayName;
            return customName && customName.toLowerCase() === input.toLowerCase();
          }
          return false;
        });

        if (matchingProfile) {
          recipientActor = matchingProfile.actor;
        }

        // 2. If no profile matches, fall back to testing it as a raw Graffiti network handle
        if (!recipientActor) {
          recipientActor = await graffiti.handleToActor(input);
        }

        // Security / Validation Checks
        if (!recipientActor) { 
          dmError.value = "User not found. Try their exact handle or profile name."; 
          return; 
        }
        if (recipientActor === session.value.actor) { 
          dmError.value = "You cannot DM yourself."; 
          return; 
        }

        // Generate the deterministic channel ID
        const chatId = `dm-${[session.value.actor, recipientActor].sort().join('-')}`;

        // 3. Check if we already have a chat with this user
        const existingChat = allChats.value.find(c => c.value.channel === chatId);
        if (existingChat) {
           recipientHandle.value = "";
           router.push(`/chat/${chatId}`); // Just open it, don't recreate it
           return;
        }

        // 4. Create the new chat objects
        const chatObj = {
          type: "Chat", title: `DM: ${input}`, channel: chatId,
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
        
      } catch (e) { 
        dmError.value = "Network error. Please try again."; 
      }
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
      getOtherActor, hideChat, formatChatName 
    };
  }
});