import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

// Import only the specific icons we need
import {
  faDownload,
  faCopy,
  faUpload,
  faTrashCan,
  faFileAudio,
  faFolderOpen,
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
  faPenToSquare,
  faSun,
  faMoon,
  faCircleHalfStroke,
} from "@fortawesome/free-solid-svg-icons";

// Import from brands
import { faGithub } from "@fortawesome/free-brands-svg-icons";

// Add only the imported icons to the library
library.add(
  // Solid icons
  faDownload,
  faCopy,
  faUpload,
  faTrashCan,
  faFileAudio,
  faFolderOpen,
  // faLoader,
  faCircleQuestion,
  faAngleDown,
  faAngleRight,
  faCircleDollarToSlot,
  faBlender,
  faPenToSquare,
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
  faSun,
  faMoon,
  faCircleHalfStroke,

  // Brand icons
  faGithub,
);

export default FontAwesomeIcon;
