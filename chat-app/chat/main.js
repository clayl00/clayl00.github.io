import { ref, computed, nextTick, watch, onMounted, onUnmounted } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import { useRouter, useRoute } from "vue-router"; 

export default async () => ({
  props: ["chatId"],
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),
  
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter(); 
    const route = useRoute();   
    
    const myMessage = ref("");
    const composer = ref(null); 
    const feedContainer = ref(null); 
    const isDeleting = ref(new Set());
    const isSending = ref(false);
    const pendingAttachment = ref(null);
    const resolvedMedia = ref({});
    const isEditingTitle = ref(false);
    const editedTitle = ref("");
    let mutationObserver = null; 

    // PROFILE MODAL STATE
    const selectedActor = ref(null);
    const resolvedHandles = ref({});

    const broadSchema = { properties: { value: { type: "object" } } };
    const globalDirectory = ["composer-central-public"];
    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);

    const { objects: pubMeta } = useGraffitiDiscover(globalDirectory, broadSchema);
    const { objects: privMeta } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    
    const chatData = computed(() => [...pubMeta.value, ...privMeta.value]
        .filter(o => o.value?.channel === props.chatId)
        .sort((a, b) => b.value.published - a.value.published)[0]?.value);
    
    const { objects: messageObjects } = useGraffitiDiscover(computed(() => [props.chatId]), broadSchema, session);
    
    const messages = computed(() => [...messageObjects.value]
        .filter(m => m?.value?.content !== undefined || m?.value?.attachment)
        .sort((a, b) => (a.value?.published || 0) - (b.value?.published || 0)));

    const uniqueActors = computed(() => {
      const actors = new Set();
      if (session.value?.actor) actors.add(session.value.actor);
      messages.value.forEach(m => { if (m.actor) actors.add(m.actor); });
      if (chatData.value?.participants) chatData.value.participants.forEach(a => actors.add(a));
      return Array.from(actors);
    });

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
          } catch (e) {
            // Fails silently
          }
        }
      });
    }, { immediate: true });

    const { objects: allSuggestions } = useGraffitiDiscover(computed(() => messages.value.map(m => m.url)), broadSchema, session);
    const actorChannels = computed(() => [...new Set([...messages.value.map(m => m.actor), session.value?.actor].filter(Boolean))]);
    
    // FETCH PROFILE OBJECTS (to get the Bio)
    const { objects: profiles } = useGraffitiDiscover(actorChannels, broadSchema, session);

    // FETCH SPECIFIC PROFILE FOR THE MODAL
    const activeProfile = computed(() => {
      if (!selectedActor.value) return null;
      return profiles.value
        .filter(p => p.channels?.includes(selectedActor.value) && p.value?.type === 'Profile')
        .sort((a, b) => b.value.published - a.value.published)[0];
    });

    function getProfileName(actorId) {
      if (!actorId) return "";
      return resolvedHandles.value[actorId] || actorId.substring(0, 8);
    }

    const chatTitle = computed(() => {
      const data = chatData.value;
      if (!data) return "Loading...";
      let name = data.title || "";
      if (data.participants && session.value?.actor) {
        const otherActor = data.participants.find(p => p !== session.value.actor);
        if (otherActor) {
          const profileName = getProfileName(otherActor);
          if (profileName && profileName !== otherActor.replace('https://', '').replace(/^did:[a-z0-9]+:/i, '').substring(0, 8)) {
            name = profileName;
          }
        }
      }
      return name.replace('.graffiti.actor', '').replace(/^DM:\s*/i, '');
    });

    const scrollToBottom = () => {
      if (feedContainer.value) feedContainer.value.scrollTop = feedContainer.value.scrollHeight;
    };

    onMounted(() => {
      if (feedContainer.value) {
        mutationObserver = new MutationObserver(() => scrollToBottom());
        mutationObserver.observe(feedContainer.value, { childList: true, subtree: true });
        scrollToBottom();
      }
    });

    onUnmounted(() => { if (mutationObserver) mutationObserver.disconnect(); });

    function hasSuggestions(msgUrl) {
      return allSuggestions.value.some(s => s.channels.includes(msgUrl) && s.value?.type === 'Suggestion');
    }

    function formatFriendlyDate(date) {
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return "Today";
      if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
      return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    }

    function getDateSeparator(index) {
      const msg = messages.value[index];
      if (!msg) return null;
      const current = new Date(msg.value?.published || Date.now());
      if (index === 0) return formatFriendlyDate(current);
      const prevMsg = messages.value[index - 1];
      const previous = new Date(prevMsg.value?.published || Date.now());
      if (current.toDateString() !== previous.toDateString()) return formatFriendlyDate(current);
      return null;
    }

    watch(messages, (newMsgs) => {
      newMsgs.forEach(msg => {
        const url = msg.value?.attachment?.url;
        if (url && url.startsWith('graffiti:') && !resolvedMedia.value[url]) {
          resolvedMedia.value[url] = 'loading'; 
          const mediaType = msg.value.attachment.mediaType || 'application/pdf';
          graffiti.getMedia(url, { types: [mediaType] }, session.value).then(media => {
            const blob = media.data instanceof Blob ? media.data : new Blob([media.data], { type: mediaType });
            resolvedMedia.value[url] = URL.createObjectURL(blob);
          }).catch(() => resolvedMedia.value[url] = null);
        }
      });
    }, { immediate: true, deep: true });

    async function saveTitle() {
      if (!editedTitle.value.trim() || !session.value || !chatData.value) return;
      const isPrivate = chatData.value.isPrivate;
      const channels = isPrivate ? [`my-private-directory-${session.value.actor}`] : globalDirectory;
      const allowed = isPrivate ? [session.value.actor] : undefined;
      await graffiti.post({
        value: { ...chatData.value, title: editedTitle.value, published: Date.now() },
        channels, allowed
      }, session.value);
      if (isPrivate && chatData.value.participants) {
        const recipient = chatData.value.participants.find(a => a !== session.value.actor);
        if (recipient) {
          await graffiti.post({
            value: { ...chatData.value, type: "ChatInvite", title: editedTitle.value, published: Date.now() },
            channels: [`discovery-${recipient}`], allowed: [recipient]
          }, session.value);
        }
      }
      isEditingTitle.value = false;
    }

    async function sendMessage() {
      if (!session.value || (!myMessage.value.trim() && !pendingAttachment.value)) return;
      isSending.value = true;
      try {
        let attachment = undefined;
        if (pendingAttachment.value) {
          const url = await graffiti.postMedia({ data: pendingAttachment.value }, session.value);
          attachment = { name: pendingAttachment.value.name, mediaType: pendingAttachment.value.type, url };
        }
        await graffiti.post({ 
            value: { content: myMessage.value, attachment, published: Date.now() }, 
            channels: [props.chatId], 
            allowed: chatData.value?.participants || undefined
        }, session.value);
        myMessage.value = ""; 
        pendingAttachment.value = null;
        nextTick(() => { if (composer.value) composer.value.style.height = 'auto'; });
      } finally { isSending.value = false; }
    }

    function toggleFullscreen() {
      if (route.query.fs === '1') {
        router.push({ query: {} }); 
      } else {
        router.push({ query: { fs: '1' } }); 
      }
    }

    return { 
      messages, myMessage, sendMessage, session, chatTitle, composer, hasSuggestions,
      getProfileName, isDeleting, resolvedMedia, isSending, getDateSeparator,
      route, toggleFullscreen, 
      selectedActor, activeProfile, // EXPORT MODAL TOOLS
      openProfile: (actorId) => { selectedActor.value = actorId; },
      closeProfile: () => { selectedActor.value = null; },
      deleteMessage: async (m) => {
        isDeleting.value.add(m.url);
        setTimeout(async () => {
          try { await graffiti.delete(m.url, session.value); } 
          finally { isDeleting.value.delete(m.url); }
        }, 300); 
      }, 
      attachFile: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const MAX_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          alert("File is too large! The maximum allowed size for uploads is 25MB.");
          e.target.value = ""; 
          return;
        }
        pendingAttachment.value = file;
      },
      pendingAttachment, clearAttachment: () => pendingAttachment.value = null,
      autoResize: () => { if (composer.value) { composer.value.style.height = 'auto'; composer.value.style.height = composer.value.scrollHeight + 'px'; } },
      handleEnter: (e) => { if (!e.shiftKey) { e.preventDefault(); sendMessage(); } },
      isEditingTitle, editedTitle, startEditing: () => { editedTitle.value = chatTitle.value; isEditingTitle.value = true; }, saveTitle,
      feedContainer 
    };
  }
});