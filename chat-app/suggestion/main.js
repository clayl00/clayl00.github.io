import { ref, computed, watch } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  // Both props are now passed from the router
  props: ["chatId", "messageId"],
  template: await fetch(new URL("./index.html", import.meta.url))
    .then((r) => r.text())
    .then((html) => html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")),
  
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    // Parse URL for the view/make action
    const hashParts = window.location.hash.split('?');
    const urlParams = new URLSearchParams(hashParts.length > 1 ? hashParts[1] : '');
    const isMakingSuggestion = ref(urlParams.get('action') === 'make');
    
    const baseMediaUrl = ref(null);
    const pdfSrc = ref("loading");
    const iframeKey = ref(0);
    const newPageNum = ref("");
    const newLocation = ref("");
    const newSuggestionText = ref("");

    const broadSchema = { properties: { value: { type: "object" } } };
    const resolvedHandles = ref({}); // Added for handle fallback resolution

    // 1. Fetch Chat Feed: Must pass 'session' to see encrypted messages
    const { objects: chatMessages } = useGraffitiDiscover(
        computed(() => [props.chatId]), 
        broadSchema, 
        session
    );

    // Find the specific message we are suggesting on
    const originalMessage = computed(() => chatMessages.value.find(m => m.url === props.messageId));

    // 2. Discover Suggestions: Must pass 'session' to see encrypted suggestions
    const { objects: suggestionObjects } = useGraffitiDiscover(
        computed(() => [props.messageId]), 
        broadSchema, 
        session
    );

    const suggestions = computed(() => [...suggestionObjects.value]
        .filter(s => s.value?.type === "Suggestion")
        .sort((a, b) => (b.value.published || 0) - (a.value.published || 0)));

    // 3. Profiles
    const actorChannels = computed(() => [...new Set([...suggestions.value.map(s => s.actor), session.value?.actor].filter(Boolean))]);
    
    // Wide Discovery to catch profiles globally
    const profileChannels = computed(() => {
      const channels = new Set(["composer-central-public", "profiles"]);
      actorChannels.value.forEach(a => {
        channels.add(a);
        channels.add(`discovery-${a}`);
      });
      return Array.from(channels);
    });

    const { objects: profiles } = useGraffitiDiscover(profileChannels, broadSchema, session);

    // Async handle resolution
    watch(actorChannels, (actors) => {
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

    // UPDATED FORMATTING FUNCTION to match Chat/Home logic
    function getProfileName(actorId) {
      if (!actorId) return "";
      
      const profile = profiles.value
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

    // PDF Loader
    watch(originalMessage, async (msg) => {
      if (msg?.value?.attachment?.url) {
        try {
          const media = await graffiti.getMedia(msg.value.attachment.url, { types: ['application/pdf'] }, session.value);
          const blob = media.data instanceof Blob ? media.data : new Blob([media.data], { type: 'application/pdf' });
          baseMediaUrl.value = URL.createObjectURL(blob);
          pdfSrc.value = baseMediaUrl.value;
        } catch (e) { pdfSrc.value = null; }
      }
    }, { immediate: true });

    // 4. Actions: Carrying over the 'allowed' list is CRITICAL for private chats
    async function postSuggestion() {
      if (!session.value || !newSuggestionText.value.trim() || !originalMessage.value) return;
      
      await graffiti.post({ 
        value: { 
          type: "Suggestion", 
          content: newSuggestionText.value, 
          page: newPageNum.value,
          location: newLocation.value,
          published: Date.now() 
        }, 
        channels: [props.messageId],
        // Carry over the encryption settings from the original message
        allowed: originalMessage.value.allowed 
      }, session.value);
      
      cancelSuggestion();
    }

    function jumpToPage(pageNum) {
      if (baseMediaUrl.value && pageNum) {
        pdfSrc.value = `${baseMediaUrl.value}#page=${pageNum}`;
        iframeKey.value++; 
      }
    }

    function cancelSuggestion() {
        isMakingSuggestion.value = false;
        newPageNum.value = ""; newLocation.value = ""; newSuggestionText.value = "";
    }

    // NEW: Open PDF in fullscreen
    function openFullscreen(e) {
      const container = e.target.closest('.pdf-workspace');
      const iframe = container.querySelector('.pdf-viewer');
      if (iframe) {
        if (iframe.requestFullscreen) {
          iframe.requestFullscreen();
        } else if (iframe.webkitRequestFullscreen) { /* Safari */
          iframe.webkitRequestFullscreen();
        } else if (iframe.msRequestFullscreen) { /* IE11 */
          iframe.msRequestFullscreen();
        }
      }
    }

    return { 
      session, pdfSrc, iframeKey, suggestions, isMakingSuggestion, 
      newPageNum, newLocation, newSuggestionText, chatId: props.chatId,
      getProfileName, startMakingSuggestion: () => isMakingSuggestion.value = true, 
      cancelSuggestion, postSuggestion, jumpToPage,
      deleteSuggestion: (url) => graffiti.delete(url, session.value),
      openFullscreen
    };
  }
});