// Buefy registers its components globally but ships no GlobalComponents
// augmentation, so vue-tsc can't match `<b-collapse>` to its typed definition and
// skips template checking. Without this, a renamed prop (Buefy 0.x `open` ->
// `modelValue`) fails silently at runtime.
import type {
  BAutocomplete,
  BBreadcrumb,
  BBreadcrumbItem,
  BButton,
  BCarousel,
  BCarouselItem,
  BCarouselList,
  BCheckbox,
  BCheckboxButton,
  BClockpicker,
  BCollapse,
  BColorpicker,
  BDatepicker,
  BDatetimepicker,
  BDialog,
  BDropdown,
  BDropdownItem,
  BField,
  BIcon,
  BImage,
  BInput,
  BLoading,
  BMenu,
  BMenuItem,
  BMenuList,
  BMessage,
  BModal,
  BNavbar,
  BNavbarDropdown,
  BNavbarItem,
  BNotification,
  BNumberinput,
  BPagination,
  BPaginationButton,
  BProgress,
  BProgressBar,
  BRadio,
  BRadioButton,
  BRate,
  BSelect,
  BSidebar,
  BSkeleton,
  BSlider,
  BSliderTick,
  BSnackbar,
  BStepItem,
  BSteps,
  BSwitch,
  BTabItem,
  BTable,
  BTableColumn,
  BTabs,
  BTag,
  BTaginput,
  BTaglist,
  BTimepicker,
  BToast,
  BTooltip,
  BUpload,
} from 'buefy';

declare module 'vue' {
  interface GlobalComponents {
    BAutocomplete: typeof BAutocomplete;
    BBreadcrumb: typeof BBreadcrumb;
    BBreadcrumbItem: typeof BBreadcrumbItem;
    BButton: typeof BButton;
    BCarousel: typeof BCarousel;
    BCarouselItem: typeof BCarouselItem;
    BCarouselList: typeof BCarouselList;
    BCheckbox: typeof BCheckbox;
    BCheckboxButton: typeof BCheckboxButton;
    BClockpicker: typeof BClockpicker;
    BCollapse: typeof BCollapse;
    BColorpicker: typeof BColorpicker;
    BDatepicker: typeof BDatepicker;
    BDatetimepicker: typeof BDatetimepicker;
    BDialog: typeof BDialog;
    BDropdown: typeof BDropdown;
    BDropdownItem: typeof BDropdownItem;
    BField: typeof BField;
    BIcon: typeof BIcon;
    BImage: typeof BImage;
    BInput: typeof BInput;
    BLoading: typeof BLoading;
    BMenu: typeof BMenu;
    BMenuItem: typeof BMenuItem;
    BMenuList: typeof BMenuList;
    BMessage: typeof BMessage;
    BModal: typeof BModal;
    BNavbar: typeof BNavbar;
    BNavbarDropdown: typeof BNavbarDropdown;
    BNavbarItem: typeof BNavbarItem;
    BNotification: typeof BNotification;
    BNumberinput: typeof BNumberinput;
    BPagination: typeof BPagination;
    BPaginationButton: typeof BPaginationButton;
    BProgress: typeof BProgress;
    BProgressBar: typeof BProgressBar;
    BRadio: typeof BRadio;
    BRadioButton: typeof BRadioButton;
    BRate: typeof BRate;
    BSelect: typeof BSelect;
    BSidebar: typeof BSidebar;
    BSkeleton: typeof BSkeleton;
    BSlider: typeof BSlider;
    BSliderTick: typeof BSliderTick;
    BSnackbar: typeof BSnackbar;
    BStepItem: typeof BStepItem;
    BSteps: typeof BSteps;
    BSwitch: typeof BSwitch;
    BTabItem: typeof BTabItem;
    BTable: typeof BTable;
    BTableColumn: typeof BTableColumn;
    BTabs: typeof BTabs;
    BTag: typeof BTag;
    BTaginput: typeof BTaginput;
    BTaglist: typeof BTaglist;
    BTimepicker: typeof BTimepicker;
    BToast: typeof BToast;
    BTooltip: typeof BTooltip;
    BUpload: typeof BUpload;
  }
}

export {};
