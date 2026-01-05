'use client';

import { useState, useEffect } from 'react';
import {
  Users, Plus, Shield, ShieldCheck, Stethoscope, User, Trash2,
  Loader2, Search, MoreVertical, Check, X, Edit, Mail, Key,
  UserPlus, AlertTriangle, CheckCircle, Clock, Ban
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

const ROLE_CONFIG = {
  super_admin: { 
    label: 'Super Admin', 
    icon: ShieldCheck, 
    color: 'bg-red-500', 
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    description: 'Full system access'
  },
  admin: { 
    label: 'Admin', 
    icon: Shield, 
    color: 'bg-purple-500', 
    textColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    description: 'Administrative access'
  },
  provider: { 
    label: 'Provider', 
    icon: Stethoscope, 
    color: 'bg-blue-500', 
    textColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    description: 'Healthcare provider'
  },
  patient: { 
    label: 'Patient', 
    icon: User, 
    color: 'bg-green-500', 
    textColor: 'text-green-600',
    bgColor: 'bg-green-50',
    description: 'Patient access'
  }
};

const STATUS_CONFIG = {
  active: { label: 'Active', color: 'bg-green-100 text-green-800' },
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-800' },
  inactive: { label: 'Inactive', color: 'bg-gray-100 text-gray-800' }
};

export default function AdminRolesPage() {
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'super_admin';
  
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Stats
  const [stats, setStats] = useState({
    totalAdmins: 0,
    totalProviders: 0,
    pendingProviders: 0,
    activeUsers: 0
  });

  // New admin form
  const [newAdminForm, setNewAdminForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'admin',
    sendInvite: true
  });

  // Load users
  useEffect(() => {
    loadUsers();
  }, [roleFilter]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params = {
        limit: 100,
        role: roleFilter !== 'all' ? roleFilter : undefined
      };
      
      const response = await adminAPI.getUsers(params);
      if (response.data.success) {
        setUsers(response.data.users);
        calculateStats(response.data.users);
      }
    } catch (error) {
      console.error('Load users error:', error);
      toast({
        title: 'Error',
        description: 'Failed to load users',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (userList) => {
    setStats({
      totalAdmins: userList.filter(u => ['admin', 'super_admin'].includes(u.role)).length,
      totalProviders: userList.filter(u => u.role === 'provider').length,
      pendingProviders: userList.filter(u => u.role === 'provider' && u.providerStatus === 'pending').length,
      activeUsers: userList.filter(u => u.isActive).length
    });
  };

  const handleCreateAdmin = async () => {
    if (!isSuperAdmin) {
      toast({
        title: 'Access Denied',
        description: 'Only Super Admins can create admin accounts',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await adminAPI.createAdmin(newAdminForm);
      
      if (response.data.success) {
        toast({
          title: 'Admin Created',
          description: newAdminForm.sendInvite 
            ? 'Admin account created and invitation sent'
            : 'Admin account created successfully',
        });
        setShowCreateModal(false);
        setNewAdminForm({
          firstName: '',
          lastName: '',
          email: '',
          role: 'admin',
          sendInvite: true
        });
        loadUsers();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create admin',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateUserStatus = async (userId, status, action) => {
    try {
      const response = await adminAPI.updateUserStatus(userId, { 
        isActive: status === 'active',
        providerStatus: action
      });
      
      if (response.data.success) {
        toast({
          title: 'Status Updated',
          description: `User status has been ${action || 'updated'}`,
        });
        loadUsers();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to update status',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await adminAPI.deleteUser(userId);
      
      if (response.data.success) {
        toast({
          title: 'User Deleted',
          description: 'User has been permanently removed',
        });
        loadUsers();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to delete user',
        variant: 'destructive'
      });
    }
  };

  // Filter users by search
  const filteredUsers = users.filter(u =>
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.lastName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <Users className="w-6 h-6 text-white" />
            </div>
            Role Management
          </h1>
          <p className="text-muted-foreground mt-1">Manage user roles, permissions, and access</p>
        </div>
        
        {isSuperAdmin && (
          <Button onClick={() => setShowCreateModal(true)} className="bg-purple-600 hover:bg-purple-700">
            <UserPlus className="w-4 h-4 mr-2" />
            Create Admin
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Administrators</p>
                <p className="text-2xl font-bold">{stats.totalAdmins}</p>
              </div>
              <Shield className="w-8 h-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Providers</p>
                <p className="text-2xl font-bold">{stats.totalProviders}</p>
              </div>
              <Stethoscope className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className={stats.pendingProviders > 0 ? 'border-yellow-500' : ''}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Approval</p>
                <p className={`text-2xl font-bold ${stats.pendingProviders > 0 ? 'text-yellow-600' : ''}`}>
                  {stats.pendingProviders}
                </p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Users</p>
                <p className="text-2xl font-bold text-green-600">{stats.activeUsers}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {['all', 'super_admin', 'admin', 'provider', 'patient'].map((role) => (
            <Button
              key={role}
              variant={roleFilter === role ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter(role)}
              className={roleFilter === role ? 'bg-purple-600' : ''}
            >
              {role === 'all' ? 'All Roles' : ROLE_CONFIG[role]?.label || role}
            </Button>
          ))}
        </div>
        
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-medium">User</th>
                  <th className="text-left p-4 font-medium">Role</th>
                  <th className="text-left p-4 font-medium">Status</th>
                  <th className="text-left p-4 font-medium">Created</th>
                  <th className="text-right p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => {
                  const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.patient;
                  const RoleIcon = roleConfig.icon;
                  const isCurrentUser = user.id === currentUser?.id;
                  
                  return (
                    <tr key={user.id} className="hover:bg-muted/30">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${roleConfig.bgColor}`}>
                            <RoleIcon className={`w-5 h-5 ${roleConfig.textColor}`} />
                          </div>
                          <div>
                            <p className="font-medium">
                              {user.firstName} {user.lastName}
                              {isCurrentUser && <Badge variant="outline" className="ml-2 text-xs">You</Badge>}
                            </p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge className={`${roleConfig.bgColor} ${roleConfig.textColor} border-0`}>
                          {roleConfig.label}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          <Badge className={user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          {user.role === 'provider' && user.providerStatus && (
                            <Badge variant="outline" className="text-xs">
                              {user.providerStatus}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          {/* Provider Approval Actions */}
                          {user.role === 'provider' && user.providerStatus === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleUpdateUserStatus(user.id, 'active', 'approved')}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleUpdateUserStatus(user.id, 'inactive', 'rejected')}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          
                          {/* Status Toggle */}
                          {!isCurrentUser && user.providerStatus !== 'pending' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUpdateUserStatus(user.id, user.isActive ? 'inactive' : 'active')}
                            >
                              {user.isActive ? <Ban className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                            </Button>
                          )}
                          
                          {/* Delete (Super Admin only, not self) */}
                          {isSuperAdmin && !isCurrentUser && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteUser(user.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {filteredUsers.length === 0 && (
            <div className="py-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No users found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Admin Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Administrator Account</DialogTitle>
            <DialogDescription>
              Create a new admin account. An invitation will be sent to their email.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input
                  value={newAdminForm.firstName}
                  onChange={(e) => setNewAdminForm(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={newAdminForm.lastName}
                  onChange={(e) => setNewAdminForm(prev => ({ ...prev, lastName: e.target.value }))}
                  placeholder="Doe"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input
                type="email"
                value={newAdminForm.email}
                onChange={(e) => setNewAdminForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="admin@company.com"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                value={newAdminForm.role}
                onChange={(e) => setNewAdminForm(prev => ({ ...prev, role: e.target.value }))}
                className="w-full h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="admin">Admin</option>
                {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sendInvite"
                checked={newAdminForm.sendInvite}
                onChange={(e) => setNewAdminForm(prev => ({ ...prev, sendInvite: e.target.checked }))}
              />
              <Label htmlFor="sendInvite" className="cursor-pointer">
                Send invitation email
              </Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAdmin}
              disabled={submitting || !newAdminForm.email || !newAdminForm.firstName}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Create Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

