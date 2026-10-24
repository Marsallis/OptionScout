import { useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import SearchIcon from '@mui/icons-material/Search';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import TuneIcon from '@mui/icons-material/Tune';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import DynamicFeedOutlinedIcon from '@mui/icons-material/DynamicFeedOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CableIcon from '@mui/icons-material/Cable';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useColorMode } from '../brand/ColorMode';
import { useExperienceMode } from '../brand/ExperienceMode';
import { Wordmark } from '../brand/Wordmark';
import { brand } from '../brand/tokens';
import { AdviceNote } from '../components/AdviceNote';
import { DemoBanner } from '../components/DemoBanner';
import { GlossaryDialog } from '../components/GlossaryDialog';
import { ThemePicker } from '../components/ThemePicker';
import { NAV_ITEMS } from '../content/pages';
import { BrokerPage } from '../pages/BrokerPage';
import { PositionDetailPage, PositionsPage } from '../pages/BrokeragePages';
import { DiscoverOpportunitiesPage } from '../pages/DiscoverOpportunitiesPage';
import { LeapsFinderPage } from '../pages/LeapsFinderPage';
import { OverviewPage } from '../pages/OverviewPage';
import { PmccBuilderPage } from '../pages/PmccBuilderPage';
import { ResearchFeedPage } from '../pages/ResearchFeedPage';
import { RiskLabPage } from '../pages/RiskLabPage';
import { SettingsPage } from '../pages/SettingsPage';
import { StrategyBuilderPage } from '../pages/StrategyBuilderPage';
import { TradeJournalPage } from '../pages/TradeJournalPage';

const DRAWER_WIDTH = 272;

const NAV_ICONS: Record<string, typeof HomeOutlinedIcon> = {
  '/': HomeOutlinedIcon,
  '/leaps': SearchIcon,
  '/discover': TravelExploreIcon,
  '/strategies': TuneIcon,
  '/pmcc': AccountTreeOutlinedIcon,
  '/positions': LayersOutlinedIcon,
  '/risk': ScienceOutlinedIcon,
  '/research': DynamicFeedOutlinedIcon,
  '/journal': MenuBookOutlinedIcon,
  '/broker': CableIcon,
  '/settings': SettingsOutlinedIcon,
};

const NAV_GROUPS: Array<{ label: string; paths: string[] }> = [
  { label: 'Research', paths: ['/', '/leaps', '/discover', '/strategies'] },
  { label: 'Portfolio', paths: ['/positions', '/broker', '/settings'] },
  { label: 'Desk', paths: ['/pmcc', '/risk', '/research', '/journal'] },
];

function ThemeToggle() {
  const { mode, toggle } = useColorMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <IconButton aria-label={`Switch to ${next} theme`} onClick={toggle} color="inherit" size="small">
      {mode === 'dark' ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
    </IconButton>
  );
}

function ExperienceToggle() {
  const { mode, setMode } = useExperienceMode();
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      aria-label="Experience"
      onChange={(_event, next: string | null) => {
        if (next === 'beginner' || next === 'pro') setMode(next);
      }}
    >
      <ToggleButton value="beginner" aria-label="Beginner view" sx={{ minHeight: 44 }}>
        Beginner
      </ToggleButton>
      <ToggleButton value="pro" aria-label="Pro view" sx={{ minHeight: 44 }}>
        Pro
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const items = new Map(NAV_ITEMS.map((item) => [item.to, item]));
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ px: 2.25, pt: 2.25, pb: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Wordmark />
        <ThemeToggle />
      </Box>
      <Box sx={{ px: 2.5, pb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Local research desk · orders off
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <ExperienceToggle />
          <GlossaryDialog />
        </Stack>
      </Box>
      <ThemePicker />
      <List sx={{ px: 1.25, flex: 1, overflow: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <Box key={group.label} sx={{ mb: 1.25 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', px: 1.25, pt: 0.75, pb: 0.25, letterSpacing: '0.08em', fontWeight: 700 }}
            >
              {group.label}
            </Typography>
            {group.paths.map((path) => {
              const item = items.get(path);
              if (!item) return null;
              const Icon = NAV_ICONS[item.to] ?? HomeOutlinedIcon;
              return (
                <ListItemButton
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  sx={{
                    mb: 0.35,
                    borderRadius: `${brand.radius.nav}px`,
                    borderLeft: '3px solid transparent',
                    color: 'text.secondary',
                    transition: `background-color ${brand.motion.fast} ${brand.motion.ease}, border-color ${brand.motion.fast} ${brand.motion.ease}, color ${brand.motion.fast} ${brand.motion.ease}`,
                    '&:hover': { backgroundColor: 'action.hover', color: 'text.primary' },
                    minHeight: 48,
                    '&.active': {
                      backgroundColor: 'action.selected',
                      borderLeftColor: 'primary.main',
                      color: 'text.primary',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={item.label} sx={{ '& .MuiListItemText-primary': { fontSize: 14, fontWeight: 650 } }} />
                </ListItemButton>
              );
            })}
          </Box>
        ))}
      </List>
      <Box sx={{ px: 2.5, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Phase 1C · No order routing
        </Typography>
      </Box>
    </Box>
  );
}

export function AppShell() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const drawer = (
    <Drawer
      variant={desktop ? 'permanent' : 'temporary'}
      open={desktop || open}
      onClose={() => setOpen(false)}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.default',
          backgroundImage: 'none',
        },
      }}
    >
      <Sidebar onNavigate={() => setOpen(false)} />
    </Drawer>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          left: 8,
          top: -40,
          zIndex: 2000,
          bgcolor: 'background.paper',
          px: 1.5,
          py: 1,
          '&:focus': { top: 8 },
        }}
      >
        Skip to content
      </Box>
      {drawer}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {desktop ? null : (
          <Toolbar
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: theme.zIndex.appBar,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              gap: 1,
            }}
          >
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Wordmark compact />
            </Box>
            <ThemeToggle />
          </Toolbar>
        )}
        {desktop ? null : (
          <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <ExperienceToggle />
          </Box>
        )}
        <DemoBanner />
        <AdviceNote />
        <Box id="main" key={pathname} className="os-page" component="main" sx={{ p: { xs: 2, sm: 2.5, md: 4 }, flex: 1, minWidth: 0 }}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/leaps" element={<LeapsFinderPage />} />
            <Route path="/discover" element={<DiscoverOpportunitiesPage />} />
            <Route path="/strategies" element={<StrategyBuilderPage />} />
            <Route path="/positions/:positionId" element={<PositionDetailPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/broker" element={<BrokerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/pmcc" element={<PmccBuilderPage />} />
            <Route path="/risk" element={<RiskLabPage />} />
            <Route path="/research" element={<ResearchFeedPage />} />
            <Route path="/journal" element={<TradeJournalPage />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
