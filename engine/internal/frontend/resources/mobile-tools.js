// Move the existing controls, retaining every native event handler and value.
// Popovers reduce phone chrome without shrinking touch targets or the canvas.
export function attachMobileTools(doc = document, view = window) {
  const media = view.matchMedia("(max-width:900px)");
  const toolbox = doc.getElementById("toolbox"),
    menu = doc.querySelector("#menu .menu-list");
  if (!toolbox || !menu) return () => {};
  const reactions = doc.getElementById("drawing-reactions"),
    reactionHome = reactions.parentElement;
  const clear = doc.getElementById("clear-canvas-button"),
    clearHome = clear.parentElement,
    clearNext = clear.nextSibling;
  const clearText = doc.createElement("span");
  clearText.textContent = "Clear canvas";
  clearText.className = "mobile-tool-label";
  clear.append(clearText);
  const gallery = doc.getElementById("gallery-voting");
  let galleryLink, galleryMenu, galleryObserver;
  if (gallery && doc.body.dataset.leagueSpectator !== "true") {
    const openGallery = () => {
      doc.getElementById("message-input")?.blur();
      if (doc.getElementById("menu").matches(":popover-open"))
        doc.getElementById("menu").hidePopover();
      const history = gallery.querySelector("details");
      if (history) {
        history.open = true;
        view.requestAnimationFrame(() =>
          history.querySelector("button:not([disabled])")?.focus(),
        );
      }
    };
    galleryLink = doc.createElement("button");
    galleryLink.type = "button";
    galleryLink.className = "mobile-gallery-link dialog-button";
    galleryLink.textContent = "Gallery votes";
    galleryLink.setAttribute("aria-controls", "gallery-voting");
    galleryLink.addEventListener("click", openGallery);
    if (doc.body.dataset.leagueMode)
      doc.getElementById("chat").insertBefore(galleryLink, doc.getElementById("message-form"));
    else doc.getElementById("league-toolbar").append(galleryLink);
    galleryMenu = doc.createElement("button");
    galleryMenu.type = "button";
    galleryMenu.className = "menu-item dialog-button";
    galleryMenu.textContent = "Gallery votes";
    galleryMenu.addEventListener("click", openGallery);
    menu.append(galleryMenu);
    galleryObserver = new view.MutationObserver(() => {
      const count = Number(gallery.getAttribute("data-pending") || 0);
      galleryLink.textContent = count ? `Gallery votes (${count})` : "Gallery votes";
    });
    galleryObserver.observe(gallery, {
      attributes: true,
      attributeFilter: ["data-pending"],
    });
  }
  let placementFrame = 0;
  const placeReactions = () => {
    placementFrame = 0;
    const keyboard = (view.visualViewport?.height ?? view.innerHeight) < 500 && doc.activeElement?.id === 'message-input';
    const destination = doc.body.dataset.leagueMode ? doc.getElementById('canvas-frame-heading') || reactionHome : media.matches && !keyboard ? doc.getElementById('lobby') : reactionHome;
    if (reactions.parentElement !== destination) destination.append(reactions);
  };
  const schedulePlacement = () => {
    if (!placementFrame)
      placementFrame = view.requestAnimationFrame(placeReactions);
  };
  const panels = [
    {
      element: doc.querySelector(".color-button-container"),
      id: "phone-colors",
      name: "Choose colour",
      text: "Colour",
    },
    {
      element: doc.getElementById("size-buttons"),
      id: "phone-brushes",
      name: "Brush size",
      text: "Size",
    },
  ].map((panel) => {
    panel.originalId = panel.element.id;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "canvas-button mobile-tool-toggle";
    button.textContent = panel.text;
    button.setAttribute("aria-label", panel.name);
    button.setAttribute("popovertarget", panel.id);
    button.setAttribute("aria-haspopup", "dialog");
    panel.element.id = panel.id;
    panel.element.setAttribute("aria-label", panel.name);
    toolbox.insertBefore(button, panel.element);
    return { ...panel, button };
  });
  const close = () => {
    for (const { element } of panels)
      if (element.matches(":popover-open")) element.hidePopover();
  };
  const update = () => {
    close();
    for (const { element, button } of panels) {
      button.hidden = !media.matches;
      if (media.matches) element.setAttribute("popover", "auto");
      else element.removeAttribute("popover");
    }
    if (media.matches) {
      placeReactions();
      menu.append(clear);
      clear.classList.add("menu-item", "dialog-button");
    } else {
      placeReactions();
      clearHome.insertBefore(clear, clearNext);
      clear.classList.remove("menu-item", "dialog-button");
    }
  };
  const chosen = (event) => {
    if (event.target.closest(".color-button,label")) close();
  };
  for (const { element } of panels) element.addEventListener("click", chosen);
  media.addEventListener("change", update);
  update();
  view.addEventListener("resize", schedulePlacement);
  view.visualViewport?.addEventListener("resize", schedulePlacement);
  doc.addEventListener("focusin", schedulePlacement);
  doc.addEventListener("focusout", schedulePlacement);
  return () => {
    close();
    galleryObserver?.disconnect();
    media.removeEventListener("change", update);
    view.removeEventListener("resize", schedulePlacement);
    view.visualViewport?.removeEventListener("resize", schedulePlacement);
    doc.removeEventListener("focusin", schedulePlacement);
    doc.removeEventListener("focusout", schedulePlacement);
    if (placementFrame) view.cancelAnimationFrame(placementFrame);
    for (const { element } of panels)
      element.removeEventListener("click", chosen);
  };
}
