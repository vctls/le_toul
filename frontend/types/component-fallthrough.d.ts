// Vue forwards attributes a component doesn't declare as props to its root element
// ($attrs), but strictTemplates checks every binding against declared props, so the
// native ones Buefy forwards have to be listed here or they read as unknown props.
//
// This widens what is accepted on *every* component, so keep it to attributes this
// app actually relies on being forwarded, not a general HTML catch-all.
declare module 'vue' {
  interface ComponentCustomProps {
    name?: string;
    title?: string;
    disabled?: boolean;
    href?: string;
    target?: string;
    rows?: number | string;
    controls?: boolean;
    src?: string;
    autocorrect?: string;
    autocapitalize?: string;
    spellcheck?: boolean | string;
    'aria-label'?: string;
    'aria-controls'?: string;
    'aria-expanded'?: boolean | string;

    onClick?: (e: MouseEvent) => void;
    onKeydown?: (e: KeyboardEvent) => void;
    onMousedown?: (e: MouseEvent) => void;
  }
}

export {};
