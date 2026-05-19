import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';

// Import only the specific icons we need
import {
  faDownload,
  faCopy,
  faUpload,
  faTrashCan,
  faFileAudio,
  // faLoader, // This icon doesn't exist in FontAwesome
  faCircleQuestion,
  faAngleDown,
  faAngleRight,
  faCircleDollarToSlot,
  faBlender,
  faCircleExclamation,
  faCircleInfo,
  faAlignLeft,
  faFlask,
  faStopwatch,
  faQuestion,
  faWarning,
  faCheck,
  faKeyboard,
  faMinus,
  faPlus,
  faSpinner,
  faWandMagicSparkles,
  faArrowRotateLeft,
} from '@fortawesome/free-solid-svg-icons';

// Import from brands
import {
  faGithub
} from '@fortawesome/free-brands-svg-icons';

// Add only the imported icons to the library
library.add(
  // Solid icons
  faDownload,
  faCopy,
  faUpload,
  faTrashCan,
  faFileAudio,
  // faLoader,
  faCircleQuestion,
  faAngleDown,
  faAngleRight,
  faCircleDollarToSlot,
  faBlender,
  faCircleExclamation,
  faCircleInfo,
  faAlignLeft,
  faFlask,
  faStopwatch,
  faQuestion,
  faWarning,
  faCheck,
  faKeyboard,
  faMinus,
  faPlus,
  faSpinner,
  faWandMagicSparkles,
  faArrowRotateLeft,

  // Brand icons
  faGithub
);

export default FontAwesomeIcon;