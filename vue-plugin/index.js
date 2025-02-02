import bridge from './bridge';
import {
  resolveComponentName,
  resolveMPType,
  collectPageInfo,
  collectVMInfo,
  decycle,
} from './utils';

const rootVMCache = [];

let versions = {};
let storeId = 0;

bridge.on('refreshPages', (fn) => {
  const stores = [];
  const pages = rootVMCache.map(rootVM => {
    const $store = rootVM.$store;

    if ($store) {
      const timestamp = Date.now();
      const storeId = $store.__devtoolStoreId;
      const subscribedPages = $store.__devtoolSubscribedPages;
      const exist = stores.some(s => s.storeId === storeId);
      if (!exist) {
        stores.push({
          storeId,
          mutation: { type: '__devtool__:init' },
          state: $store.state,
          subscribedPages,
          timestamp,
        });
      }
    }

    return {
      pageInfo: collectPageInfo(rootVM),
      component: collectVMInfo(rootVM),
    };
  });

  fn({
    versions,
    pages,
    stores,
  });
});

export default {
  install(Vue, options) {
    versions = {
      vue: Vue.version,
      megalo: Vue.megaloVersion,
    };

    const oEmit = Vue.prototype.$emit;

    Vue.prototype.$emit = function(type, data) {
      const vm = this;
      oEmit.call(vm, type, data);

      let emitterName = 'Root';
      if (vm.$vnode) {
        emitterName = resolveComponentName(vm.$vnode.tag);
      }
      handleEvent(vm, emitterName, type, data, 'component');
    }

    const oGlobalEventHandler = Vue.config.globalEventHandler;
    Vue.config.globalEventHandler = function(vm, data, vnode, handlers) {
      if (oGlobalEventHandler) {
        oGlobalEventHandler.call(this, vm, data, vnode, handlers);
      }
      let emitterName = vnode.tag || 'text';
      handleEvent(vm, emitterName, data.type, data, 'element');
    }

    Vue.mixin({
      onLaunch() {
        bridge.emit({
          module: 'components',
          lifecycle: 'launch',
          type: 'app',
          data: {
            versions,
          }
        });
      },
      onLoad() {
        // new page load
        bridge.emit({
          module: 'components',
          lifecycle: 'load',
          type: resolveMPType(this)
        });
      },
      mounted() {
        const type = resolveMPType(this);
        if (type === 'page') {
          const pageInfo = collectPageInfo(this);
          const component = collectVMInfo(this);
          bridge.emit({
            module: 'components',
            lifecycle: 'mounted',
            type,
            data: {
              pageInfo,
              component
            },
          });

          handleStore(this.$store, pageInfo);

          rootVMCache.unshift(this);
        }
      },
      updated() {
        if (this.$mp.page) {
          const pageInfo = collectPageInfo(this);
          const component = collectVMInfo(this);
          bridge.emit({
            module: 'components',
            lifecycle: 'updated',
            type: 'component',
            data: {
              pageInfo,
              component
            },
          });

        }
      },
      beforeDestroy() {
        const type = resolveMPType(this);
        if (type === 'page') {
          const pageInfo = collectPageInfo(this);
          const component = collectVMInfo(this);
          bridge.emit({
            module: 'components',
            lifecycle: 'beforeDestroy',
            type,
            data: {
              pageInfo,
              component
            },
          });

          const index = rootVMCache.findIndex(vm => vm === this);
          rootVMCache.splice(index, 1);
        }
      },
    })
  }
}


function handleEvent(vm, emitterName, type, data, emitterType) {
  const event = decycle(data, 20, ['_isVue', 'state', '_vm', '$store']);
  const pageInfo = collectPageInfo(vm);

  bridge.emit({
    module: 'events',
    data: {
      emitterName,
      pageInfo,
      type,
      event,
      emitterType
    }
  });
}

function handleStore(store, pageInfo) {
  if (!store) {
    return;
  }

  if (store.__devtoolStoreId === undefined) {
    store.__devtoolStoreId = storeId;
    storeId++;
  }

  // record pages subscribed to this store
  if (!store.__devtoolSubscribedPages) {
    store.__devtoolSubscribedPages = []
  }
  store.__devtoolSubscribedPages.push(pageInfo)

  if (store && !store.__devtoolSubscribed) {
      const storeId = store.__devtoolStoreId;
      const subscribedPages = store.__devtoolSubscribedPages;
      bridge.emit({
        module: 'vuex',
        data: {
          storeId,
          mutation: { type: '__devtool__:init' },
          state: store.state,
          subscribedPages,
        },
      });

      store.subscribe((mutation, state) => {
        bridge.emit({
          module: 'vuex',
          data: {
            storeId,
            mutation,
            state,
            subscribedPages,
          },
        });
      });
      store.__devtoolSubscribed = true;
  }
}