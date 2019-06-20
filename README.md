ember-template-styles-import
==============================================================================

This addon allows you to import CSS classes into your templates, a la CSS
Modules:

```scss
// app/pods/button/styles.scoped.scss
.hello {
  color: green;
}
```

```hbs
{{import styles from "./styles.scoped.scss"}}

<div class={{styles.hello}}>
  I'm green!
</div>
```

This provides:

1. **Encapsulation**: imported CSS classes are rewritten as randomized names,
ensuring that they will only apply where imported and won't collide with any
other classes.

2. **Colocation**: keep your stylesheets right next to your templates

Plus:

* It works in apps, addons, and even dummy apps inside addons!
* Works with both pods and classic layouts!
* Relative imports!
* No runtime overhead (only build time transforms)!
* Unused CSS detection (coming soon)
* Missing styles detection (coming soon)

Installation
------------------------------------------------------------------------------

```
ember install ember-template-styles-import
```


Usage in Apps
------------------------------------------------------------------------------

Just drop your stylesheets anywhere in `app/`, adding the `.scoped.scss`
extension. Note: Sass is the only supported format for now, but should be easy
to add others. Write your styles as you normally would:

```scss
.foo {
  display: flex;
}

.bar {
  color: blue;
}
```

Now in your template, import the stylesheets you want:

```hbs
{{import styles from "./styles.scoped.scss"}}
{{import buttonStyles from "../../styles/buttons.scoped.scss"}}

<div class={{styles.foo}}></div>
<button class={{buttonStyles.primary}}>Click me!</button>
```

Note that the above format is the only kind of import syntax supported (unlike
actual ES2015 which supports lots of variations of that).

The stylesheet is looked up relative to your current file, and top level class
declarations are rewritten with randomized class names to avoid collisions.
Nested class declarations in Sass are left untouched.

Usage in Addons
------------------------------------------------------------------------------

If styling apps can be confusing, styling addons is downright painful. But no
more!

ember-template-styles-import takes your addon's `addon/styles` folder, and
makes it available to the consuming app under a folder named after your
addon. So if a consuming app imports `my-cool-addon/foo.scss`, they'll get
`addon/styles/foo.scss`.

With that in mind, we suggest using an `index.scss` as an "entry point", so
users can simply `@import 'your-cool-addon'` and get all the necessary styles.

You can also `@import 'pod-styles.scss'` from this manifest file to use style
imports in your addon's components.

**Do apps consuming my addon also need ember-template-styles-import?**
Nope!

Motivation
------------------------------------------------------------------------------

I've long been a fan of ember-component-css, but unfortunately it's approach
is pretty fundamentally at odds with the new Glimmer components. It relies on
local class state, which means you cannot use it with template-only components.

This addon attempts to improve on the ergonomics of ember-component-css by
making styles traceable (i.e. follow the import path to see where it comes from),
improve performance (by doing all the work at build time vs. run time), and work
with Glimmer's template-only components.

But what about SFCs / Template Import RFC?
------------------------------------------------------------------------------

This addon works mostly through some slightly unpleasant wrangling of Ember CLI's
build process. Once first class template imports land, there's a good chance this
will be obsoleted.

But for the impatient and adventurous among you, you can dabble with these things
today.

But be warned - any official tooling to codemod apps into the new Template
Imports world likely won't support this addon. So weigh the pros and cons
carefully before widely adopting this addon.

License
------------------------------------------------------------------------------

This project is licensed under the [MIT License](LICENSE.md).
