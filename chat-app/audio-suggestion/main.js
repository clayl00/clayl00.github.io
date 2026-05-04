import { ref, computed, watch } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
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
    
    const audioSrc = ref("loading");
    const audioPlayer = ref(null); // Reference to control the HTML5 <audio> element
    const newTime = ref("");
    const newSuggestionText = ref("");

    const broadSchema = { properties: { value: { type: "object" } } };

    // 1. Fetch original message to get attachment URL and encryption settings
    const { objects: chatMessages } = useGraffitiDiscover(
        computed(() => [props.chatId]), 
        broadSchema, 
        session
    );
    const originalMessage = computed(() => chatMessages.value.find(m => m.url === props.messageId));

    // 2. Discover Suggestions
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
    const { objects: profiles } = useGraffitiDiscover(actorChannels, broadSchema, session);

    function getProfileName(actorId) {
      const latest = profiles.value.filter(p => p.channels?.includes(actorId) && p.value?.type === 'Profile').sort((a, b) => b.value.published - a.value.published)[0];
      return latest?.value?.handle || actorId.substring(0, 8); 
    }

    // Audio Loader
    watch(originalMessage, async (msg) => {
      if (msg?.value?.attachment?.url) {
        try {
          // Discover the dynamic media type or default to mp3
          const mediaType = msg.value.attachment.mediaType || 'audio/mpeg';
          const media = await graffiti.getMedia(msg.value.attachment.url, { types: [mediaType] }, session.value);
          const blob = media.data instanceof Blob ? media.data : new Blob([media.data], { type: mediaType });
          audioSrc.value = URL.createObjectURL(blob);
        } catch (e) { audioSrc.value = null; }
      }
    }, { immediate: true });

    // 4. Actions
    async function postSuggestion() {
      if (!session.value || !newSuggestionText.value.trim() || !originalMessage.value) return;
      
      await graffiti.post({ 
        value: { 
          type: "Suggestion", 
          content: newSuggestionText.value, 
          time: newTime.value, // Using 'time' instead of page/location
          published: Date.now() 
        }, 
        channels: [props.messageId],
        allowed: originalMessage.value.allowed 
      }, session.value);
      
      cancelSuggestion();
    }

    // Helper to parse time string and seek the audio player
    function jumpToTime(timeStr) {
      if (!audioPlayer.value || !timeStr) return;
      
      let seconds = 0;
      // Handle both "1:23" format and pure seconds like "83"
      if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      } else {
        seconds = parseFloat(timeStr);
      }

      if (!isNaN(seconds)) {
        audioPlayer.value.currentTime = seconds;
        audioPlayer.value.play(); // Auto-play when they jump to a timestamp
      }
    }

    function cancelSuggestion() {
        isMakingSuggestion.value = false;
        newTime.value = ""; newSuggestionText.value = "";
    }

    return { 
      session, audioSrc, audioPlayer, suggestions, isMakingSuggestion, 
      newTime, newSuggestionText, chatId: props.chatId,
      getProfileName, startMakingSuggestion: () => isMakingSuggestion.value = true, 
      cancelSuggestion, postSuggestion, jumpToTime,
      deleteSuggestion: (url) => graffiti.delete(url, session.value)
    };
  }
});