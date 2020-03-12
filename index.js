'use strict';
/* eslint-env node */
const path = require('path');
const BroccoliFilter = require('broccoli-persistent-filter');
const Merge = require('broccoli-merge-trees');
const Concat = require('broccoli-concat');
const Funnel = require('broccoli-funnel');
const postcss = require('postcss');
const stew = require('broccoli-stew');
const postcssScss = require('postcss-scss');
const { hash } = require('spark-md5');

let rewriterPlugin = postcss.plugin('postcss-importable', ({ filename, deep }) => {
  return (css) => {
    if (deep) {
      css.walkRules((rule) => {
        rule.selectors = rule.selectors.map((selector) => {
          let name = selector.slice(1);
          return '.' + generateScopedName(name, filename);
        });
      });
    } else {
      css.nodes.forEach((node) => {
        if (node.type === 'rule') {
          node.selectors = node.selectors.map((selector) => {
            let name = selector.slice(1);
            return '.' + generateScopedName(name, filename);
          });
        }
      });
    }
  };
});

class StylesRewriter extends BroccoliFilter {

  constructor(inputNode, options = {}) {
    super(inputNode, { persist: true, ...options });
    this.options = options;
    this.extensions = [ 'scoped.scss' ];
    this.targetExtension = 'scoped.scss';
  }

  baseDir() {
    return __dirname;
  }

  processString(contents, relativePath) {
    let namespace = this.options.namespace;
    return postcss([
      rewriterPlugin({
        filename: `${ namespace }/${ relativePath }`,
        deep: false
      })
    ])
    .process(contents, {
      from: relativePath,
      to: relativePath,
      parser: postcssScss
    })
    .then((results) => results.css);
  }
}

function isApp(appOrAddon) {
  return !isAddon(appOrAddon);
}

function isAddon(appOrAddon) {
  return !!appOrAddon.pkg.keywords && appOrAddon.pkg.keywords.indexOf('ember-addon') > -1;
}

function isDummyAppBuild(self) {
  return isAddon(self.parent) && self.parent.name === self.project.name && self.parent.pkg === self.project.pkg;
}

function generateScopedName(name, relativePath) {
  relativePath = relativePath.replace(/\\/g, '/');
  const prefix = relativePath.split('/').slice(-2)[0];
  let hashKey = `${ name }--${ relativePath }`;
  return `${prefix}_${name}_${ hash(hashKey).slice(0, 5) }`;
}


const IMPORT_PATTERN = /\{\{\s*import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"]\s*\}\}/gi;

function isValidVariableName(name) {
  return /^[A-Za-z0-9.-]+$/.test(name);
}


class TemplateStylesImportProcessor extends BroccoliFilter {

  constructor(inputNode, options = {}) {
    if (!options.hasOwnProperty('persist')) {
      options.persist = true;
    }

    super(inputNode, {
      annotation: options.annotation,
      persist: options.persist
    });

    this.options = options;
    this._console = this.options.console || console;

    this.extensions = ['hbs', 'handlebars'];
    this.targetExtension = 'hbs';
  }

  baseDir() {
    return __dirname;
  }

  processString(contents, relativePath) {
    let imports = [];
    let rewrittenContents = contents.replace(IMPORT_PATTERN, (_, localName, importPath) => {
      if (!importPath.endsWith('.scoped.scss')) { // .scss or other extensions
        return _;
      }
      if (importPath.startsWith('.')) {
        importPath = path.resolve(relativePath, '..', importPath).split(path.sep).join('/');
        importPath = path.relative(this.options.root, importPath).split(path.sep).join('/');
      }
      imports.push({ localName, importPath, isLocalNameValid: isValidVariableName(localName) });
      return '';
    });

    let header = imports.map(({ importPath, localName, isLocalNameValid, dynamic }) => {
      const warnPrefix = 'ember-template-styles-import: ';
      const abstractWarn = `${warnPrefix} Allowed import variable names - camelCased strings, like: fooBar, tomDale`;
      const helperWarn = `
        ${warnPrefix}Warning!
        in file: "${relativePath}"
        subject: "${localName}" is not allowed as Variable name for styles import.`;
      const warn = isLocalNameValid ? '' : `
        <pre data-test-name="${localName}">${helperWarn}</pre>
        <pre data-test-global-warn="${localName}">${abstractWarn}</pre>
      `;
      if (!isLocalNameValid) {
        this._console.log(helperWarn);
        if (relativePath !== 'dummy/pods/application/template.hbs') {
          // don't throw on 'dummy/pods/application/template.hbs' (test template)
          throw new Error(helperWarn);
        }
      }
      if (localName[0].toLowerCase() === localName[0]) {
        const styleRegex = localName + '\\.([^\\} )]+)';
        rewrittenContents = rewrittenContents.replace(new RegExp('{{[^\\}]*' + styleRegex + '[^\\}]*}}', "g"), (mustache, styleClass) => {
          const replaced = mustache.replace(new RegExp('([= {])' + styleRegex + '([^}]*}})', 'g'), (_, before, style, after) => {
            return before + '"' + generateScopedName(styleClass, importPath) + '"' + after;
          });
          return replaced;
        });
      }
      return warn;
    }).join('');

    return header + rewrittenContents + ' ';
  }

}

module.exports = {
  name: require("./package").name,

  included(includer) {
    this.includer = includer;
    this.definedClasses = new Map();
    this.usedClasses = new Map();
    // If we are being used inside an addon, then we want the addon's scoped styles
    // to be processed, but not the consuming app's. So we wrap the parent addon's
    // treeForAddonStyles to process them for scoping.
    if (isAddon(this.parent)) {
      let original = this.parent.treeForStyles || ((t) => t);
      let self = this;
      this.parent.treeForStyles = function(stylesInput = path.join(this.root, this.treePaths['addon-styles'])) {
        let originalOutput = original.call(this, stylesInput);
        let scopedOutput = self._scopedStyles(path.join(this.root, this.treePaths.addon), this.name);
        originalOutput = new Funnel(originalOutput, { srcDir: this.treePaths.styles });
        return stew.mv(new Merge([ originalOutput, scopedOutput ]), this.treePaths.styles + '/' + this.name);
      }
    }
  },

  treeForStyles(tree) {
    let trees = [];
    if (tree) {
      trees.push(tree);
    }
    if (isApp(this.parent)) {
      trees.push(this._scopedStyles(path.join(this.parent.root, 'app'), this.parent.name()));
    }
    if (isDummyAppBuild(this)) {
      trees.push(this._scopedStyles(path.join(this.project.root, 'app'), this.parent.name(), `${ this.parent.name() }-pod-styles.scss`));
      trees.push(this._scopedStyles(path.join(this.project.root, 'tests', 'dummy', 'app'), 'dummy'));
    }
    return new Merge(trees);
  },

  _scopedStyles(tree, namespace, outputFile = 'pod-styles.scss') {
    tree = new Funnel(tree, { include: [ `**/*.scoped.scss` ]});
    tree = new StylesRewriter(tree, {
      namespace
    });
    tree = new Concat(tree, { allowNone: true, outputFile });
    return tree;
  },

  setupPreprocessorRegistry(type, registry) {
    // this is called before init, so, we need to check podModulePrefix later (in toTree)
    let componentsRoot = null;
    const projectConfig = this.project.config();
    const podModulePrefix = projectConfig.podModulePrefix;

    // by default `ember g component foo-bar --pod`
    // will create app/components/foo-bar/{component.js,template.hbs}
    // so, we can handle this case and just fallback to 'app/components'

    if (podModulePrefix === undefined) {
      componentsRoot = path.join(this.project.root, 'app', 'components');
    } else {
      componentsRoot = path.join(this.project.root, podModulePrefix);
    }

    registry.add('template', {
      name: 'ember-template-styles-import',
      ext: 'hbs',
      toTree: (tree) => {
        tree = new TemplateStylesImportProcessor(tree, { root: componentsRoot });
        return tree;
      }
    });

    if (type === "parent") {
      this.parentRegistry = registry;
    }
  }
};
