import { ref, computed, nextTick, watch } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  props: ["chatId"],
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),
  
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    // PRESERVED REFS
    const myMessage = ref("");
    const composer = ref(null); 
    const isDeleting = ref(new Set());
    const isSending = ref(false);
    const pendingAttachment = ref(null);
    const resolvedMedia = ref({});
    const isEditingTitle = ref(false);
    const editedTitle = ref("");

    const broadSchema = { properties: { value: { type: "object" } } };
    const globalDirectory = ["composer-central-public"];
    const myDirChannel = computed(() => session.value ? [`my-private-directory-${session.value.actor}`] : []);

    // 1. Meta Discovery
    const { objects: pubMeta } = useGraffitiDiscover(globalDirectory, broadSchema);
    const { objects: privMeta } = useGraffitiDiscover(myDirChannel, broadSchema, session);
    
    const chatData = computed(() => [...pubMeta.value, ...privMeta.value]
        .filter(o => o.value?.channel === props.chatId)
        .sort((a, b) => b.value.published - a.value.published)[0]?.value);
    
    const chatTitle = computed(() => chatData.value?.title || "Loading...");

    // 2. Message Feed
    const { objects: messageObjects } = useGraffitiDiscover(computed(() => [props.chatId]), broadSchema, session);
    const messages = computed(() => [...messageObjects.value]
        .filter(m => m?.value?.content !== undefined || m?.value?.attachment)
        .sort((a, b) => (a.value.published || 0) - (a.value.published || 0)));

    // 3. Suggestions & Profiles
    const { objects: allSuggestions } = useGraffitiDiscover(computed(() => messages.value.map(m => m.url)), broadSchema, session);
    const actorChannels = computed(() => [...new Set([...messages.value.map(m => m.actor), session.value?.actor].filter(Boolean))]);
    const { objects: profiles } = useGraffitiDiscover(actorChannels, broadSchema, session);

    // PRESERVED: Profile Name Resolver
    function getProfileName(actorId) {
      const latest = profiles.value.filter(p => p.channels?.includes(actorId) && p.value?.type === 'Profile').sort((a, b) => b.value.published - a.value.published)[0];
      return latest?.value?.handle || actorId.substring(0, 8); 
    }

    function hasSuggestions(msgUrl) {
      return allSuggestions.value.some(s => s.channels.includes(msgUrl) && s.value?.type === 'Suggestion');
    }

    // PRESERVED: Media Watcher
    watch(messages, (newMsgs) => {
      newMsgs.forEach(msg => {
        const url = msg.value?.attachment?.url;
        if (url && url.startsWith('graffiti:') && !resolvedMedia.value[url]) {
          resolvedMedia.value[url] = 'loading'; 
          graffiti.getMedia(url, { types: ['application/pdf'] }, session.value).then(media => {
            const blob = media.data instanceof Blob ? media.data : new Blob([media.data], { type: 'application/pdf' });
            resolvedMedia.value[url] = URL.createObjectURL(blob);
          }).catch(() => resolvedMedia.value[url] = null);
        }
      });
    }, { immediate: true, deep: true });

    // 4. FIXED ACTIONS: No more 'this' keyword
    function startEditing() {
      editedTitle.value = chatTitle.value;
      isEditingTitle.value = true;
    }

    async function saveTitle() {
      if (!editedTitle.value.trim() || !session.value || !chatData.value) return;
      
      const isPrivate = chatData.value.isPrivate;
      const channels = isPrivate ? [`my-private-directory-${session.value.actor}`] : globalDirectory;
      const allowed = isPrivate ? [session.value.actor] : undefined;

      // Update local directory
      await graffiti.post({
        value: { ...chatData.value, title: editedTitle.value, published: Date.now() },
        channels, 
        allowed
      }, session.value);

      // If private, send an updated invite to the recipient so their sidebar title changes
      if (isPrivate && chatData.value.participants) {
        const recipient = chatData.value.participants.find(a => a !== session.value.actor);
        if (recipient) {
          await graffiti.post({
            value: { ...chatData.value, type: "ChatInvite", title: editedTitle.value, published: Date.now() },
            channels: [`discovery-${recipient}`],
            allowed: [recipient]
          }, session.value);
        }
      }

      isEditingTitle.value = false;
    }

    // PRESERVED: Send Message with encryption support
    async function sendMessage() {
      if (!session.value || (!myMessage.value.trim() && !pendingAttachment.value)) return;
      isSending.value = true;
      try {
        let attachment = undefined;
        if (pendingAttachment.value) {
          const url = await graffiti.postMedia({ data: pendingAttachment.value }, session.value);
          attachment = { name: pendingAttachment.value.name, mediaType: 'application/pdf', url };
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

    // PRESERVED: Deletion and UI Helpers
    async function deleteMessage(m) {
      isDeleting.value.add(m.url);
      try { await graffiti.delete(m.url, session.value); } 
      finally { isDeleting.value.delete(m.url); }
    }

    const autoResize = () => { 
      if (composer.value) { 
        composer.value.style.height = 'auto'; 
        composer.value.style.height = composer.value.scrollHeight + 'px'; 
      } 
    };

    const handleEnter = (e) => { 
      if (!e.shiftKey) { 
        e.preventDefault(); 
        sendMessage(); 
      } 
    };

    return { 
      messages, myMessage, sendMessage, session, chatTitle, composer, hasSuggestions,
      getProfileName, deleteMessage, isDeleting, resolvedMedia, isSending,
      attachFile: (e) => pendingAttachment.value = e.target.files[0],
      pendingAttachment, clearAttachment: () => pendingAttachment.value = null,
      autoResize, handleEnter,
      isEditingTitle, editedTitle, startEditing, saveTitle
    };
  }
});