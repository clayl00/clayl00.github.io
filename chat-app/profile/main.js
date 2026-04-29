import { ref, reactive, computed, watch } from "vue";
import { useGraffiti, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
  
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    
    const formData = reactive({ handle: "", bio: "" });
    const originalData = reactive({ handle: "", bio: "" });
    const status = ref("idle"); // 'idle' | 'dirty' | 'saved'

    // Discover the user's latest Profile object posted to their own actor channel
    const myChannel = computed(() => session.value ? [session.value.actor] : []);
    const { objects: profileObjects } = useGraffitiDiscover(myChannel, { 
      properties: { value: { type: "object", properties: { type: { const: "Profile" } } } } 
    });

    // Watch for the network to load the profile, then initialize the form
    watch(profileObjects, (newObjs) => {
      if (newObjs.length > 0 && status.value !== 'dirty') {
        const latestProfile = [...newObjs].sort((a, b) => b.value.published - a.value.published)[0].value;
        
        originalData.handle = latestProfile.handle || "";
        originalData.bio = latestProfile.bio || "";
        
        formData.handle = originalData.handle;
        formData.bio = originalData.bio;
      }
    }, { immediate: true, deep: true });

    function markDirty() {
      if (formData.handle !== originalData.handle || formData.bio !== originalData.bio) {
        status.value = 'dirty';
      } else {
        status.value = 'idle';
      }
    }

    function revertChanges() {
      formData.handle = originalData.handle;
      formData.bio = originalData.bio;
      status.value = 'idle';
    }

    async function saveProfile() {
      if (!session.value) return;
      
      await graffiti.post({
        value: {
          type: "Profile",
          handle: formData.handle,
          bio: formData.bio,
          published: Date.now()
        },
        channels: [session.value.actor]
      }, session.value);

      // Update the baseline data so it's no longer considered "dirty"
      originalData.handle = formData.handle;
      originalData.bio = formData.bio;
      status.value = 'saved';
      
      // Dismiss success banner after 3 seconds
      setTimeout(() => { if (status.value === 'saved') status.value = 'idle'; }, 3000);
    }

    return { session, formData, status, markDirty, saveProfile, revertChanges };
  }
});