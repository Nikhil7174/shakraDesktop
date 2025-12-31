import React from 'react';
import { Modal, Button } from 'antd';

interface RestartModalProps {
  open: boolean;
  onClose: () => void;
}

export const RestartModal: React.FC<RestartModalProps> = ({
  open,
  onClose
}) => {
  return (
    <Modal
      title="Restart Required"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
      centered
      maskClosable={false}
    >
      <p>Kindly restart the Shakra app to give a new interview.</p>
    </Modal>
  );
};

